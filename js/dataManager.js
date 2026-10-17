const config = require('../data/config');
const sparqlClient = require('./sparqlClient');
const queryTemplates = require('../data/queryTemplates'); // para preparar las consultas
const util = require('./util'); // para el hash de las consultas
const logger = require('./logger'); // para el logging
const mustache = require('mustache');
const { LRUCache } = require('lru-cache');

// oct-26: revisión muy importante
// - nueva caché basada en lru-cache
// - inclusión de índice para evitar recorrer las claves de la caché
// - gestión de la caché unificada aquí
// - adaptación al nuevo modelo de recursos: fusión de oprops y dprops
// - agrupo propiedades si son sencillas para reducir consultas
// - soporte a joins en el modelo
// - cacheo de las consultas por API
// - actualizaciones de las consultas no se cachean
// - nuevas opciones de configuración por API (singletonArrays) y endpoint (resourcePage)

// CACHÉ
// inicializo la caché => global para todo CRAFTS
const cache = new LRUCache({
	maxSize: config.defaultOptions.cache.maxSize,
	sizeCalculation: obj =>	obj.__building? 1 : Buffer.byteLength(JSON.stringify(obj), "utf8"),
	ttl: config.defaultOptions.cache.ttl,
	ttlAutopurge: config.defaultOptions.cache.ttlAutopurge,
	updateAgeOnGet: config.defaultOptions.cache.updateAgeOnGet,
	// mantenimiento del índice con el borrado aquí
	dispose(value, key, reason) {
		const parts = key.split("|");
		// sólo debería habe 3 partes
		if (parts.length !== 3)
	        return;
		if (parts[1] === "__Q__") // consulta parametrizada
			cacheQtempsIndex[parts[0]]?.delete(parts[2]);
		else // recurso
			cacheModelIndex[parts[0]]?.[parts[1]]?.delete(parts[2]);

		/* log de recursos
		if (parts[1] !== "__Q__") {
		logger.debug({
			apiId: parts[0],
			type: parts[1] === "__Q__" ? "query-template" : "resource",
			key,
			reason,
			info: "Cache entry removed and index updated"
		});
		}*/
	}
});

// ÍNDICE CACHÉ
// inicializo cacheModelIndex y cacheQtempsIndex => global para todo CRAFTS
const cacheModelIndex = Object.create(null);
const cacheQtempsIndex = Object.create(null);


// LIMPIEZA DE LA CACHÉ POR API
function cleanAPICache(apiId, onlyQT) {
	// onlyQT se usa tras las actualizaciones de recursos
	if (apiId == null)
		return;
	if (!cacheModelIndex[apiId] && !cacheQtempsIndex[apiId])
	    return;
	//console.log(`Cleaning cache for API ${apiId}`);
	const start = Date.now();
	let ne = 0;
	let nq = 0;
	// primero vacío los recursos de la caché, usando el índice
	if (!onlyQT && cacheModelIndex[apiId]) {
		for (const melId in cacheModelIndex[apiId]) {
			for (const iri of [...cacheModelIndex[apiId][melId]]) {
				const key = `${apiId}|${melId}|${iri}`;
				cache.delete(key);
				ne++;
			}
		}
		// borro el índice de recursos de la api
		delete cacheModelIndex[apiId];
	}
	// en todos casos vacío las consultas parametrizadas
	if (cacheQtempsIndex[apiId]) {
		for (const hash of [...cacheQtempsIndex[apiId]]) {		
			const key = `${apiId}|__Q__|${hash}`;
			cache.delete(key);
			nq++;
		}
		// borro el índice de consultas de la api
		delete cacheQtempsIndex[apiId];
	}
	// log
	const elapsed = Date.now() - start;
	logger.debug({
		apiId,
		nents: ne,
		nqueries: nq,
		elapsed,
		info: 'API cache cleaned'
	});
}

// BORRADO RECURSO CACHÉ
function deleteResourceCache(api, melid, iri) {
	const key = `${api.config.apiId}|${melid}|${iri}`;
	cache.delete(key);
	
	/* versión anterior: innecesario buscar anidamientos
	borro exclusivamente el recurso, sin anidar
	
	const apiIndex = cacheModelIndex[api.config.apiId];
	if (!apiIndex)
		return;
	// inicializo borrados caché
	const borradosCache = Object.create(null); // iris por modelo
	// lo hago recursivo
	const visited = new Set();
	const entries = [];
	entries.push( { evmelid: melid, eviri: iri } );
	while (entries.length > 0) {
		// extraigo la última entrada
		const { evmelid, eviri } = entries.pop();
		// si ya está procesada, continuamos
		const visitKey = `${evmelid}|${eviri}`;
		if (visited.has(visitKey))
			continue;
		visited.add(visitKey);
		// si no existe en el índice, continuamos
		if (!apiIndex[evmelid]?.has(eviri))
			continue;
		// existe, lo incluyo para borrar
		borradosCache[evmelid] ??= new Set();
		borradosCache[evmelid].add(eviri);
		// analizo si hay algo embebido en ese modelo
		const evmel = api.modelById[evmelid];
		const evmelext = getExtendedMel(api, evmel);
		const candels = [];
		for (const collection of [evmelext.props, evmelext.types, evmelext.joins]) {
			for (const item of collection) {
				if (item.targetId != null && item.embed)
					candels.push(item);
			}
		}
		if (candels.length === 0)
			continue;
		// recupero el objeto de la caché y extraigo las cosas embebidas
		// voy a la caché sin hacer resourceSliding 
		const evkey = `${api.config.apiId}|${evmelid}|${eviri}`;
		const event = cache.get(evkey, { updateAgeOnGet: false });
		// si no hay datos o recurso en construcción, seguimos
		if (!event || event.__building)
			continue;
		// incluyo las entradas embebidas
		for (const item of candels) {
			const valores = event[item.label] ?? [];
			for (const valor of valores)
				entries.push( { evmelid: item.targetId, eviri: valor } );
		}
	}	
    // borro las entradas marcadas para borrar
    for (const mid in borradosCache) {
    	for (const biri of borradosCache[mid]) {
			const key = `${api.config.apiId}|${mid}|${biri}`;
			cache.delete(key);
    	}
    }*/
}


// BORRADO RECURSOS REFERENCIADOS CACHÉ
function deleteReferencesCache(api, objcache) {
	// obtengo el índice para esta api
	const apiIndex = cacheModelIndex[api.config.apiId];
	if (!apiIndex)
		return;
		
	// no hago trato diferenciado a objcache.mods y objcache.refs
	// (al menos en esta versión)
	const modrefs = [...objcache.mods, ...objcache.refs];
	if (modrefs.length === 0)
		return;
	
	// inicializo borrados caché
	const borradosCache = Object.create(null); // iris por modelo
	
	// analizo el índice para cada modelo
	for (const melid in apiIndex) {
		// detecto cacheos en modrefs
		const iris = modrefs.filter(iri => apiIndex[melid].has(iri));
		// si no hay nada, al siguiente
		if (iris.length === 0)
			continue;			
		// a borrar lo que haya
		borradosCache[melid] = new Set();
		for (const iri of iris)
			borradosCache[melid].add(iri);
	}
	
	/* versión anterior, demasiado agresiva la limpieza
	
	for (const melid in apiIndex) {
		// primero miro si hay cacheada alguna referencia para melid
		const riris = new Set([...objcache.refs].filter(riri => apiIndex[melid].has(riri)));
		// hacemos lo mismo para los mods
		const miris = new Set([...objcache.mods].filter(miri => apiIndex[melid].has(miri)));
		// si no hay nada, al siguiente
		if (riris.size === 0 && miris.size === 0)
			continue;
		// incluimos para borrar lo que haya
		borradosCache[melid] = new Set();
		for (const riri of riris)
			borradosCache[melid].add(riri);
		// si no hay mods, nos vamos
		if (miris.size === 0)
			continue;
		// actualizamos los borrados con los miris
		for (const miri of miris)
			borradosCache[melid].add(miri);	
		// esto es overkill, no lo veo
		// ahora viene lo complicado, buscamos potenciales referencias a miris
		for (const evmel of api.config.model) {
			// miro primero si hay índice del modelo (si no, no seguimos)
			const modelIndex = apiIndex[evmel.id];
			if (!modelIndex)
				continue;
			// obtengo modelo extendido
			const evmelext = getExtendedMel(api, evmel);
			// elementos que pueden contener referencias a mel
			const candels = [];
			for (const collection of [evmelext.props, evmelext.types, evmelext.joins]) {
				for (const item of collection) {
					if (item.targetId === melid)
						candels.push(item);
				}
			}
			// si no hay elementos relevantes, paso al siguiente modelo
			if (candels.length === 0)
				continue;
			// examino los recursos cacheados del modelo
			for (const eviri of modelIndex) {
				// ignoro recursos ya marcados para borrar
				if (borradosCache[evmel.id]?.has(eviri))
					continue;
				// voy a la caché sin hacer resourceSliding 
				const evkey = `${api.config.apiId}|${evmel.id}|${eviri}`;				
				const event = cache.get(evkey, { updateAgeOnGet: false });
				// si no hay datos o recurso en construcción, seguimos
				if (!event || event.__building)
					continue;
				// compruebo si alguna propiedad apunta a una de las iris eliminadas
				for (const item of candels) {
					const valores = event[item.label] ?? [];
					if (valores.some(valor => miris.has(valor))) {
						borradosCache[evmel.id] ??= new Set();
						borradosCache[evmel.id].add(eviri);
						break;
					}
				}
			}
		}
	}*/
	
    // borro las referencias encontradas de la caché
    for (const melid in borradosCache) {
    	for (const iri of borradosCache[melid]) {
			const key = `${api.config.apiId}|${melid}|${iri}`;
			cache.delete(key);
    	}
    }
}



// FUNCIÓN PARA PROBAR QUE FUNCIONA EL ENDPOINT
async function testEndpoint(endpoint, qtid, qinfo) {
	// hago consulta de prueba
	const qtemp = queryTemplates.queryTemplates.find( el => el.id === qtid );
	await sparqlClient.queryEndpoint(endpoint, qtemp.template, {}, null, qinfo);	
	// fue todo bien
	return;
}

// FUNCIÓN PARA RESPONDER A UNA CONSULTA PARAMETRIZADA
async function answerQuery(api, qtemp, aux, qinfo) {
	// 2021-02-02: cacheo consultas
	// 2021-07-12: reajusto el cacheo de consultas, agrupando por cada uri del punto sparql (esuri)
	// oct-26: cacheo por api
		
	// recupero el endpoint
	const endpoint = api.endpointsById[qtemp.endpoint];

	// obtengo el hash de la consulta
	const objaux = {
		ep: endpoint,
		qt: qtemp,
		au: aux
	}
	const hash = util.getHash(objaux);
	
	// preparo la clave con el id de la api y el hash
	const key = `${api.config.apiId}|__Q__|${hash}`;
	
	// recupero de la caché
	const getOptions = api.config.options?.cache?.querySliding == null ? 
		{} : { updateAgeOnGet: api.config.options.cache.querySliding };
	const salida = {
		data: qinfo.nocache? null : cache.get(key, getOptions),
		cached : true
	};
	
	// si no está en la caché, hay que hacer la consulta
	if (!salida.data) {
		// recupero los datos
		salida.data = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, qtemp.define, qinfo);
		// si no devuelve datos hay un problema
		if (!salida.data)
			return null;
		// actualizo la caché
		if (!qinfo.nocache) {
			salida.cached = false;
			const setOptions = api.config.options?.cache?.queryTTL == null ? 
				{} : { ttl: api.config.options.cache.queryTTL };
			cache.set(key, salida.data, setOptions);
			// actualizo el índice
			cacheQtempsIndex[api.config.apiId] ??= new Set();
			cacheQtempsIndex[api.config.apiId].add(hash);
		}
	}
	
	return salida;
}


// FUNCIÓN GENERAL PARA OBTENER DATOS
// obtengo datos de un conjunto de iris de un determinado tipo
// se utiliza el modelo de la caché para ver qué datos extraer
async function getData(obj, qinfo, writeonlytoo) {
	// 2021-mar modificación para tipos de elementos writeonly
	if (writeonlytoo == null)
		writeonlytoo = false;

	// compruebo si el tipo de datos existe en el modelo
	const mel = obj.api.modelById[obj.id];
	if (mel == null)
		throw Error("Check your model, incorrect data type => " + obj.id);
	
	// tipo correcto, pido los datos
	const salida = await extractResources(obj.iris, mel, obj.api, qinfo, writeonlytoo);
		
	// ahora genero la salida deseada
	salida.data = await createRepresentations(obj.iris, mel, obj.api, writeonlytoo);
	
	// devuelvo la salida
	return salida;
}


// FUNCIONES PARA FORMATEAR LA SALIDA
async function createRepresentations(iris, mel, api, writeonlytoo) {
	// preparo objeto con la salida
	const obj = [];
	for (const iri of iris) {
		const ent = formatResource(iri, mel, api, writeonlytoo);
		if (ent != null)
			obj.push( ent );
	}		
	return obj;
}

function formatResource(iri, mel, api, writeonlytoo) {
	// recupero recurso de la caché
	const getOptions = api.config.options?.cache?.resourceSliding == null ? 
		{} : { updateAgeOnGet: api.config.options.cache.resourceSliding };
	const key = `${api.config.apiId}|${mel.id}|${iri}`;
	const ent = cache.get(key, getOptions);
	if (!ent)
		return null;

	// preparo objeto a devolver
	const obj = { iri: iri };	
	
	// 2021-11-05 trabajo aquí con melext para manejar bien las herencias
	const melext = getExtendedMel(api, mel);
	
	// ajuste de colapsar arrays singleton
	const singletonArrays =	api.config.options?.singletonArrays ?? config.defaultOptions.singletonArrays;
	const collapse = singletonArrays === "collapse";
	
	// itero sobre todos los elementos sin distinción
	for (const collection of [melext.types, melext.props, melext.joins]) {
		for (const item of collection) {
			// incluyo según writeonlytoo (global) o por elemento
			if (writeonlytoo || !item.writeonly) {
				//console.log(` -> reading value for key "${item.label}"`);
				// siempre existirá ent[item.label] salvo en un caso muy raro:
				// propiedad writeonly no recuperada que se pide formatear luego
				if ( ent[item.label] && ent[item.label].length > 0 ) { // incluyo sólo si hay algo
					// si no hay targetId y embed, me quedo simplemente con la lista
					if (item.targetId == null || !item.embed)
						obj[item.label] = [...ent[item.label]];
					else {	// construyo la lista de elementos a incluir
						obj[item.label] = [];
						const evmel = api.modelById[item.targetId];
						for (const eviri of ent[item.label]) {
							const evobj = formatResource(eviri, evmel, api, writeonlytoo);
							if (evobj != null)
								obj[item.label].push(evobj);
							else // no existe el recurso destino, simplemente preparo un objeto con la iri
								obj[item.label].push( { "iri": eviri} );
						}			
					}
					// tratamiento de singletonArrays según la API
					// refinamiento: si el resultado es una lista con un objeto, quito la lista y me quedo con el objeto
					if (collapse) {
						if (obj[item.label].length === 1)
							obj[item.label] = obj[item.label][0];
					}
				}
			}
		}
	}
	
	return obj;
}


// extracción resourcePage
function getResourcePage(endpoint) {
	const { min, max, defaultValue } = config.defaultOptions.endpoints.resourcePage;
	const erp = endpoint.resourcePage;
	return erp != null && erp >= min && erp <= max
		? erp
		: defaultValue;
}

// extracción limit
function getLimit(endpoint) {
	const { min, max, defaultValue } = config.defaultOptions.endpoints.limit;
	const elimit = endpoint.limit;
	return elimit != null && elimit >= min && elimit <= max
		? elimit
		: defaultValue;
}


// FUNCIONES DE EXTRACCIÓN DE DATOS
// (si no están en la caché de la API se piden al cliente SPARQL)
// VARIANTE UNIONS
async function extractResources(iris, mel, api, qinfo, writeonlytoo) {	
	// inicializo recursos en la caché
	const getOptions = api.config.options?.cache?.resourceSliding == null ? 
		{} : { updateAgeOnGet: api.config.options.cache.resourceSliding };
	const setOptions = api.config.options?.cache?.resourceTTL == null ? 
		{} : { ttl: api.config.options.cache.resourceTTL };
	const keypref = `${api.config.apiId}|${mel.id}|`;
	const newents = new Set(); // para purgar al final (estado __building)
	for (const iri of iris) {
		const key = keypref + iri;
		const ent = cache.get(key, getOptions);
		if (!ent) {
			cache.set(key, { iri, __building: true }, setOptions);
			newents.add(iri);
		}
		else if (ent.__building)
			newents.add(iri);
	}
	
	// array de promesas para obtener los datos (en cascada)
	const promesas = [];
		
	// 2021-11-05 trabajo aquí con melext para manejar bien las herencias
	const melext = getExtendedMel(api, mel);	
	
	// oct-26: rehago para el refinamiento del modelo hecho en CRAFTSv2
	
	// primero detecto si hay que compactar o no
	const compact = api.config.options?.compactQueries ?? config.defaultOptions.compactQueries;
	
	// extraigo los tipos y props procesables
	const types = melext.types.filter(el => writeonlytoo || !el.writeonly);
	const props = melext.props.filter(el => writeonlytoo || !el.writeonly);

	// divido en singles y groups (por endpoint)
	const singles = [];
	const groups = Object.create(null); // una clave por endpoint
	for (const el of [...types, ...props]) {
		if (!compact || (el.altResult || el.orderBy || el.limit || el.offset))
			singles.push(el);
		else { // agrupable
			groups[el.endpoint] ??= Object.create(null);
			groups[el.endpoint][el.label] = el;
		}
	}
	// si un grupo es de un solo elemento, lo paso a un single
	for (const ep in groups) {
		const els = Object.values(groups[ep]);
		if (els.length === 1) {
			singles.push(els[0]);
			delete groups[ep];
		}
	}
	
	// singles se procesan de uno en uno
	for (const el of singles) 
		promesas.push( extractSingleElement(iris, mel.id, el, api, qinfo) );
		
	// los grupos van en una promesa por endpint
	for (const ep in groups)
		promesas.push( extractMultipleElements(iris, mel.id, groups[ep], api, qinfo) );
	
	
	// espero a que terminen todas...
	const resps = await Promise.all(promesas);
	

	// extracción de joins una vez terminada la extracción de tipos y props
	const promesasJoins = [];
	for (const join of melext.joins)
		promesasJoins.push( extractJoin(iris, mel.id, join, api, qinfo) );
		
		
	// espero a que terminen todas...
	const respJoins = await Promise.all(promesasJoins);
	
	
	// a falta de los retargets, los objetos están completos
	// quito __building y actualizo la caché para el cálculo del tamaño
	// además, incluyo en el índice de la caché
	if (newents.size > 0) {
		// inicializo cacheModelIndex
		cacheModelIndex[api.config.apiId] ??= Object.create(null);
		cacheModelIndex[api.config.apiId][mel.id] ??= new Set();
		for (const iri of newents) {
			const key = keypref + iri;
			const ent = cache.get(key, getOptions);
			if (!ent)
				continue;
			delete ent.__building;
			cache.set(key, ent, setOptions);
			// actualizo índice
			cacheModelIndex[api.config.apiId][mel.id].add(iri);
		}
	}
	
	// proceso los retargets si hay targetId y embed para cada tipo/prop/join
	// (en principio sólo pueden ser IRIs por la restricción de type === "uri" con targetId)
	// intento combinar los retargets si es posible
	const remels = Object.create(null);
	const retargets = Object.create(null);
	const candels = []; // los types/props/joins a evaluar
	// extraigo los candels y remels
	// y aprovecho para inicializar los retargets
	for (const collection of [types, props, melext.joins]) {
		for (const candel of collection) {
			if (candel.targetId != null && candel.embed) {
				candels.push(candel);
				remels[candel.targetId] ??= api.modelById[candel.targetId];
				retargets[candel.targetId] ??= [];
			}
		}
	}
	
	// itero sobre cada entidad y luego sobre los candels
	for (const iri of iris) {
		const ent = cache.get(keypref + iri, getOptions);
		if (!ent || ent.__building)
			continue;
		// tenemos entidad, vamos sobre cada candel para incluir los retargets
		for (const candel of candels) {
			if (ent[candel.label]?.length > 0)
				retargets[candel.targetId].push(...ent[candel.label]);
		}
	}
	
	// pido ahora la extracción de retargets
	const promesasRetargets = [];
	for (const reid in retargets) {
		if (retargets[reid].length > 0) {
			const reiris = [ ...new Set(retargets[reid]) ];
			promesasRetargets.push( extractResources(reiris, remels[reid], api, qinfo, writeonlytoo) );
		}
	}
	
	// espero a que terminen todas...
	const respRetargets = await Promise.all(promesasRetargets);

	// inicializo el conteo de consultas	
	const nc = {
		numberOfQueries: 0,
		allQueries: 0
	};
	// cuento todas las consultas hechas
	for (const resp of [...resps, ...respJoins, ...respRetargets]) {
		nc.numberOfQueries += resp.numberOfQueries;
		nc.allQueries += resp.allQueries;
	}
		
	// devuelvo el objeto con las consultas
	return nc;
}


async function extractSingleElement(iris, id, el, api, qinfo) {
	const getOptions = api.config.options?.cache?.resourceSliding == null ? 
		{} : { updateAgeOnGet: api.config.options.cache.resourceSliding };
	const keypref = `${api.config.apiId}|${id}|`;
	
	// obtengo los recursos sin info del elemento
	const eviris = [];
	for (const iri of new Set(iris)) { // convierto aquí a Set para quitar posibles duplicados
		const ent = cache.get(keypref + iri, getOptions);
		if (ent[el.label] == null)
			eviris.push(iri);
	}
	
	// 16/12/21 soporte a bindings alternativos
	const outvar = el.altVariable != null? el.altVariable : "o";
	
	// extraigo endpoint para las consultas
	const endpoint = api.endpointsById[el.endpoint];
	
	// obtengo el tamaño de la página
	const pagina = getResourcePage(endpoint);
	
	// inicializo respuesta
	const nc = {
		numberOfQueries: 0,
		allQueries: Math.ceil(iris.length / pagina)
	};
	
	// obtengo las plantillas
	const qtpred = queryTemplates.queryTemplates.find(qt => qt.id === "genPredicate");
	const qtemp = queryTemplates.queryTemplates.find( qt => qt.id === "objects" );
	
	// inicializo el objeto auxiliar para la consulta
	const aux = {
		limit: getLimit(endpoint),
		...el, // si hay límite, lo pisará
		predicate: mustache.render(qtpred.template, el)
	};
	
	// no itero si hay límite u offset
	const iterar = el.limit == null && el.offset == null;

	// solouri es para limitar los valores a extraer a uris
	const solouri = el.targetId != null || el.proptype === "object";
	
	// hago peticiones con páginas de iris en secuencia
	while (eviris.length > 0) {
		const loteiris = eviris.splice(0, pagina);
		
		// guardo los resultados en un objeto local y actualizo al final
		const objaux = Object.create(null);
		// inicializo para cada iri un array
		for (const iri of loteiris)
			objaux[iri] = [];
			
		// ajusto el offset por lote
		aux.offset = el.offset;		
		// incluyo subjects para la consulta
		aux.subjects = loteiris.map(iri => `<${iri}>`);
		
		// iteramos mientras no hayamos llegado al límite
		let datos;
		do {
			// espero a tener los resultados...
			datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, null, qinfo);		

			// proceso los resultados en objaux
			for (const row of datos.results.bindings) {
				// recupero datos
				const miiri = row.s.value;
				// sólo guardo si es una de las iris de loteiris
				if (!(miiri in objaux))
					continue;
				const value = extractSPARQLValue(row[outvar], solouri);
				if (value != null) 
					objaux[miiri].push(value);			
			}		
			// incremento consultas
			nc.numberOfQueries++;			
			// pongo el offset
			aux.offset = (aux.offset ?? 0) + aux.limit;		
		} while (iterar && datos.results.bindings.length === aux.limit);
		
		// actualizo la caché tras recuperar todos los datos
		for (const iri of loteiris) {
			const ent = cache.get(keypref + iri, getOptions);
			ent[el.label] = objaux[iri];
		}
	}
	
	// devuelvo objeto con las consultas hechas y las totales sin cacheo
	return nc;
}


async function extractMultipleElements(iris, id, multiel, api, qinfo) {
	const getOptions = api.config.options?.cache?.resourceSliding == null ? 
		{} : { updateAgeOnGet: api.config.options.cache.resourceSliding };
	const keypref = `${api.config.apiId}|${id}|`;
	
	// obtengo lista de recursos sin info del elemento
	const eviris = [];
	for (const iri of new Set(iris)) { // convierto aquí a Set para quitar posibles duplicados
		const ent = cache.get(keypref + iri, getOptions);
		// me quedo con las entidades en construcción
		if (ent.__building)
			eviris.push(iri);
	}
	
	// extraigo todos los elementos del grupo
	const allels = Object.values(multiel);
	
	// extraigo endpoint para las consultas (me basta con coger cualquier elemento de multiel)
	const endpoint = api.endpointsById[allels[0].endpoint];
	
	// obtengo el tamaño de la página
	const pagina = getResourcePage(endpoint);
	
	// inicializo respuesta
	const nc = {
		numberOfQueries: 0,
		allQueries: Math.ceil(iris.length / pagina)
	};
	
	// obtengo las plantillas
	const qtpred = queryTemplates.queryTemplates.find(qt => qt.id === "genPredicate");
	const qtunion = queryTemplates.queryTemplates.find(qt => qt.id === "genUnionItem");
	const qtemp = queryTemplates.queryTemplates.find( qt => qt.id === "multipredobjs" );
	
	// preparo las uniones que incluiré en mi plantilla final
	const unions = [];
	for (const el of allels) {
		const auxel = { 
			...el,
			predicate: mustache.render(qtpred.template, el)
		};
		const unitem = mustache.render(qtunion.template, auxel);
		unions.push(unitem);
	}
	
	// con las uniones preparo el objeto auxiliar para la consulta de verdad
	const aux = {
		unionsblock: unions.join("\nUNION "),
		limit: getLimit(endpoint)
	};
	
	// hago peticiones con páginas de iris en secuencia
	while (eviris.length > 0) {
		const loteiris = eviris.splice(0, pagina);
		
		// para evitar problemas de concurrencia guardo los resultados en un objeto local y luego actualizo
		const objaux = Object.create(null);
		
		// inicialización para cada iri
		for (const iri of loteiris) {
			objaux[iri] = Object.create(null);
			for (const el of allels)
				objaux[iri][el.label] = [];
		}
		
		// incluyo subjects para la consulta
		aux.subjects = loteiris.map(iri => `<${iri}>`);
		// inicialmente sin offset este lote
		delete aux.offset;
		
		// iteramos mientras no hayamos llegado al límite
		let datos;
		do {
			datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, null, qinfo);
			
			// proceso los resultados en objaux
			for (const row of datos.results.bindings) {
				// recupero datos
				const miiri = row.s.value;
				const pl = row.pl.value;
				// sólo continúo si es una de las iris de loteiris
				if (!(miiri in objaux))
					continue;
				// extraigo el a partir de pl
				const el = multiel[pl];
				// protección defensiva
				if (!el)
					continue;			
				// compruebo si el valor debe ser una uri
				const solouri = el.targetId != null || el.proptype === "object";
				// uso una función para extraer el valor
				const value = extractSPARQLValue(row.o, solouri);
				if (value != null)
					objaux[miiri][pl].push(value);
			}
	
			// incremento consultas
			nc.numberOfQueries++;			
			// pongo el offset
			aux.offset = (aux.offset ?? 0) + aux.limit;			
		} while (datos.results.bindings.length === aux.limit);
		
		// actualizo la caché
		for (const iri of loteiris) {
			const ent = cache.get(keypref + iri, getOptions);
			for (const el of allels)
				ent[el.label] = objaux[iri][el.label];
		}
	}
	
	// devuelvo objeto con las consultas hechas y las totales sin cacheo
	return nc;
}

async function extractJoin(iris, id, el, api, qinfo) {
	const getOptions = api.config.options?.cache?.resourceSliding == null ? 
		{} : { updateAgeOnGet: api.config.options.cache.resourceSliding };
	const keypref = `${api.config.apiId}|${id}|`;
	
	// obtengo lista de recursos sin info del elemento
	const eviris = [];
	for (const iri of new Set(iris)) { // convierto aquí a Set para quitar posibles duplicados
		const ent = cache.get(keypref + iri, getOptions);
		if (ent[el.label] == null)
			eviris.push(iri);
	}	
	
	// soporte a bindings alternativos
	const outvar = el.altVariable != null? el.altVariable : "o";
	
	// extraigo endpoint para las consultas
	const endpoint = api.endpointsById[el.endpoint];
	
	// obtengo el tamaño de la página
	const pagina = getResourcePage(endpoint);
	
	// cuento número de valores de sources
	const numsourcevals = el.source === "iri" ? iris.length  // ("iri" es un caso especial)
		: iris.reduce((sum, iri) => {
				const cached = cache.get(keypref + iri, getOptions);
				return sum + (cached?.[el.source]?.length || 0);
			}, 0);
	
	// inicializo respuesta
	const nc = {
		numberOfQueries: 0,
		allQueries: Math.ceil(numsourcevals / pagina) // no tengo en cuenta posibles repeticiones en numsourcevals
	};
	
	// preparo las entradas
	const inputSet = new Set();
	const iriInputsMap = new Map();
	const inputRegex = el.inputRegex? new RegExp(el.inputRegex) : null;
	for (const iri of eviris) {
		// inicializo la iri en el mapa
		iriInputsMap.set(iri, new Set());
		// extraigo valores
		const cached = cache.get(keypref + iri, getOptions);
		const sourcevals = el.source === "iri"? [ iri ] // "iri" es un caso especial
			: (cached?.[el.source] || []).map(val => {
				if (val && typeof val === "object") {
					const values = Object.values(val);
					return values.length > 0 ? values[0] : null;
				}
				return val;
			});
		// preparo los inputs
		for (const sv of sourcevals) {
			let input = sv;
			// aplico regex si existe
			if (inputRegex) {
    			const match = input.match(inputRegex);
		    	if (!match)
		    		continue;
	    		input = match[el.inputRegexGroup ?? 1];
	    		if (input == null)
		    		continue;
			}
			// aplico la transformación si existe
			if (el.inputTransform) 
				input = mustache.render(el.inputTransform, { input });
			// guardo
			inputSet.add(input);
			iriInputsMap.get(iri).add(input);
		}
	}
	const inputs = [...inputSet];
	
	// inicializo el mapa de resultados
	const inputResults = new Map();
	for (const input of inputs)
		inputResults.set(input, new Set());
	
	// obtengo las plantillas
	const qtpred = queryTemplates.queryTemplates.find(qt => qt.id === "genPredicate");
	const qtemp = queryTemplates.queryTemplates.find( qt => qt.id === "objects" );
	
	// inicializo el objeto auxiliar para la consulta
	const aux = { 
		limit: getLimit(endpoint),
		...el, // si hay límite, lo pisará
		predicate: mustache.render(qtpred.template, el)
	};
	
	// inicializo también los tipos numéricos
	const numericTypes = new Set([
		"http://www.w3.org/2001/XMLSchema#decimal",
		"http://www.w3.org/2001/XMLSchema#integer",
		"http://www.w3.org/2001/XMLSchema#double",
		"http://www.w3.org/2001/XMLSchema#float"
	]);
	
	// no itero si hay límite u offset
	const iterar = el.limit == null && el.offset == null;
	
	// solouri es para limitar los valores a extraer a uris
	const solouri = el.targetId != null || el.proptype === "object";
	
	// hago peticiones con páginas de inputs en secuencia
	while (inputs.length > 0) {
		const loteinputs = inputs.splice(0, pagina);
		
		// ajusto el offset por lote
		aux.offset = el.offset;
		// incluyo subjects para la consulta
		aux.subjects = loteinputs;
	
		// iteramos mientras no hayamos llegado al límite
		let datos;
		do {
			datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, null, qinfo);
		
			// incorporo los resultados a inputResults
			for (const row of datos.results.bindings) {
				let miinput = row.s.value;
			
				// reconstruyo miinput según el tipo de dato
				if (row.s.type === "uri")
					miinput = "<" + miinput + ">";
				else if (numericTypes.has(row.s.datatype))
					miinput = Number(miinput);
				else
					miinput = '"' + miinput + '"';
			
				// sólo guardo si es una de las entradas
				if (!inputResults.has(miinput))
					continue;
				
				const value = extractSPARQLValue(row[outvar], solouri);
				if (value != null)
					inputResults.get(miinput).add(value);
			}
		
			// incremento consultas
			nc.numberOfQueries++;
			// pongo el offset
			aux.offset = (aux.offset ?? 0) + aux.limit;		
		} while (iterar && datos.results.bindings.length === aux.limit);
	}
	
	// guardo los resultados
	for (const iri of eviris) {
		const iriresults = new Set();
		for (const input of iriInputsMap.get(iri)) {
			if (inputResults.has(input)) {
				for (const result of inputResults.get(input))
					iriresults.add(result);
			}
		}
		// actualizo la caché
		const ent = cache.get(keypref + iri, getOptions);
		ent[el.label] = [...iriresults];
	}

	// devuelvo objeto con las consultas hechas y las totales sin cacheo
	return nc;
}


function extractSPARQLValue(val, solouri) {
	if (val == null || val.type === "bnode") // nunca incluyo blank nodes 
		return null;	
	if (val.type === "uri")
		return val.value;
	// si sólo admito uris devuelvo null
	if (solouri)
		return null;
		
	// a partir de aquí los literales
	
	// literal con etiqueta de idioma
	if (val["xml:lang"] != null)
		return { [val["xml:lang"]] : val.value };

	// literales sin datatype
	if (!val.datatype)
		return { [config.nolang] : val.value };

	// fecha
	if (val.datatype === "http://www.w3.org/2001/XMLSchema#dateTime") {
		const d = new Date(val.value);
		return isNaN(d.getTime()) ? val.value : d.toISOString();
	}

	// booleano
	if (val.datatype === "http://www.w3.org/2001/XMLSchema#boolean")
		return ["true", "1"].includes(val.value);

	// números
	const numericTypes = new Set([
		"http://www.w3.org/2001/XMLSchema#decimal",
		"http://www.w3.org/2001/XMLSchema#integer",
		"http://www.w3.org/2001/XMLSchema#double",
		"http://www.w3.org/2001/XMLSchema#float"
	]);
	if (numericTypes.has(val.datatype))
		return Number(val.value);

	// string explícito
	if (val.datatype === "http://www.w3.org/2001/XMLSchema#string")
		return { [config.nolang] : val.value };

	// datatype desconocido:
	// intento convertir a número y, si no puedo, devuelvo el valor textual
	const n = Number(val.value);
	if (!isNaN(n))
		return n;
	return val.value;
}


// 2021-11-05 soporte a herencias
// devuelvo un mel extendido a partir de las herencias
function getExtendedMel(api, mel) {
	// sept-26: revisado
    const melext = {
        id: mel.id,
        props: [],
        types: [],
        joins: []
    };

    const visited = new Set();
    let melev = mel;

    while (melev) {
        if (visited.has(melev.id))
            throw new Error(
                `Inheritance cycle detected for ${melev.id}`
            );

        visited.add(melev.id);

        melext.props.push(...(melev.props || []));
        melext.types.push(...(melev.types || []));
        melext.joins.push(...(melev.joins || []));

        if (melev.extends == null)
            break;

        melev = api.modelById[melev.extends];
        if (!melev)
            throw new Error(`Parent model not found`);
    }

    return melext;
}

module.exports = {
	testEndpoint,
	
	answerQuery,
	getData,
	
	getExtendedMel,
	
	cleanAPICache,
	deleteResourceCache,
	deleteReferencesCache
}