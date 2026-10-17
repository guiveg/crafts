const config = require('../data/config');
const dataManager = require('./dataManager');

// 31-3-23 detectado un problema con la caché en las actualizaciones
// puede seguir algo en la caché de manera errónea si la misma IRI de un recurso RDF
// se emplea en modelos diferentes, para evitarlo cambio la manera de borrar,
// guardando las IRIs de manera plana y luego iterando por todos los modelos de la API

// 4-10-23 actualizado para mejorar la gestión de la caché en las actualizaciones
// ahora con cada tripla generada se marcan para borrar el sujeto y el objeto de cada tripla generada
// además, se marca en la caché cualquier elemento que referencie a algún recurso actualizado

// oct-26: revisión importante, manteniendo la misma lógica
// - modernizado el código
// - revisado para el nuevo modelo de recursos
// - liberación del cacheado delegado al dataManager
// - pequeño cambio en la estructura para la caché: nuevo objcache

// CREACIÓN/REEMPLAZO DE RECURSO
async function putResource(iri, objr, mel, api, qinfo) {
	// 2021-mar incluyo datos writeonly en la definición del modelo		
	// primero borro el recurso de la caché (para pedir de los endpoints todos los datos, incluidos los de solo escritura)
	dataManager.deleteResourceCache(api, mel.id, iri);

	// luego pido los datos del recurso en cuestión incluyendo datos de escritura (para poder borrarlos)
	const obj = {
		api: api,
		id: mel.id,
		iris: [iri]
	};
	// recupero datos,  incluyendo datos de escritura (la caché de la API se actualizará automáticamente)
	 // en datos.data[0] habrá una representación del recurso
	const datos = await dataManager.getData(obj, qinfo, true);
	
	// oct-26: inicializo objeto para la caché
	const objcache = {
		mods : new Set(), // iris borradas/creadas/modificadas
		refs : new Set() // lista de iris con valores tocados en las triplas
	};
	
	// obtengo las triplas para borrar en los endpoints que soporten SPARQL Update
	const edt = getEndpointTriples(false, iri, datos.data[0], mel, api, objcache);

	// obtengo las triplas para insertar en los endpoints que soporten SPARQL Update
	const eit = getEndpointTriples(true, iri, objr, mel, api, objcache);
	
	// console.log("Triplas borrar:");
	// console.log(edt);
	// console.log("Triplas insertar:");
	// console.log(eit);	
	
	// inicializo objeto a devolver
	const resp = {
		deletedTriples: 0,
		insertedTriples: 0,
		numberOfQueries: 0
	};
	
	// hago las borrados
	for (const epid in edt) {
		if (edt[epid].length > 0) {
			// preparo la consulta
			const qt = {			
				template : getUpdateOperation(false, edt[epid]),
				endpoint : `${epid}_update`
			};
			// pido el borrado
			await dataManager.answerQuery(api, qt, {}, qinfo);
			// actualizo datos a devolver
			resp.deletedTriples += edt[epid].length;
			resp.numberOfQueries++;
		}	
	}
	
	// hago las inserciones
	for (const epid in eit) {
		if (eit[epid].length > 0) {	
			// preparo la consulta
			const qt = {
				template : getUpdateOperation(true, eit[epid]),
				endpoint : `${epid}_update`
			};
			// pido la inserción
			await dataManager.answerQuery(api, qt, {}, qinfo);
			// actualizo datos a devolver
			resp.insertedTriples += eit[epid].length;
			resp.numberOfQueries++;
		}
	}
	
	// tras modificar los triplestores, actualizamos la cache
	dataManager.deleteReferencesCache(api, objcache);
	
	// y que borre todas las consultas cacheadas de la api
	dataManager.cleanAPICache(api.config.apiId, true);
	
	// y hemos terminado
	return resp;
}



// BORRADO DE RECURSO
async function deleteResource(iri, mel, api, qinfo) {
	// 2021-mar incluyo datos writeonly en la definición del modelo		
	// primero borro el recurso de la caché (para pedir de los endpoints todos los datos, incluidos los de solo escritura)
	dataManager.deleteResourceCache(api, mel.id, iri);
	
	// luego pido los datos del recurso en cuestión incluyendo datos de escritura (para poder borrarlos)
	const obj = {
		api: api,
		id: mel.id,
		iris: [iri]
	};
	
	// recupero datos,  incluyendo datos de escritura (la caché de la API se actualizará automáticamente)
	// en datos.data[0] habrá una representación del recurso
	const datos = await dataManager.getData(obj, qinfo, true);
	
	// oct-26: inicializo objeto para la caché
	const objcache = {
		mods : new Set(), // iris borradas/creadas/modificadas
		refs : new Set() // lista de iris con valores tocados en las triplas
	};
	
	// obtengo las triplas para borrar en los endpoints que soporten SPARQL Update
	const edt = getEndpointTriples(false, iri, datos.data[0], mel, api, objcache);
	
	// inicializo objeto a devolver
	const resp = {
		deletedTriples: 0,
		numberOfQueries: 0
	};
	
	// hago las borrados
	for (const epid in edt) {
		if (edt[epid].length > 0) {
			// preparo la consulta
			const qt = {			
				template : getUpdateOperation(false, edt[epid]),
				endpoint : `${epid}_update`
			};
			// pido el borrado
			await dataManager.answerQuery(api, qt, {}, qinfo);
			// actualizo datos a devolver
			resp.deletedTriples += edt[epid].length;
			resp.numberOfQueries++;			
		}	
	}

	// tras modificar los triplestores, actualizamos la cache
	dataManager.deleteReferencesCache(api, objcache);
	
	// y que borre todas las consultas cacheadas de la api
	dataManager.cleanAPICache(api.config.apiId, true);
	
	// y hemos terminado
	return resp;
}



// ACTUALIZACIÓN DE RECURSO
async function patchResource(iri, patch, mel, api, qinfo) {
	// 2021-mar incluyo datos writeonly en la definición del modelo		
	// primero borro el recurso de la caché (para pedir de los endpoints todos los datos, incluidos los de solo escritura)
	dataManager.deleteResourceCache(api, mel.id, iri);
	
	// luego pido los datos del recurso en cuestión incluyendo datos de escritura (para poder borrarlos)
	const obj = {
		api: api,
		id: mel.id,
		iris: [iri]
	};
	
	// recupero datos,  incluyendo datos de escritura (la caché de la API se actualizará automáticamente)
	const datos = await dataManager.getData(obj, qinfo, true); // en datos.data[0] habrá una representación del recurso
	const objr = datos.data[0]; // guardo aquí la representación del recurso
	
	// oct-26: inicializo objeto para la caché
	const objcache = {
		mods : new Set(), // iris borradas/creadas/modificadas
		refs : new Set() // lista de iris con valores tocados en las triplas
	};
	
	// inicializo objeto a devolver
	const resp = {
		deletedTriples: 0,
		insertedTriples: 0,
		numberOfQueries: 0
	};
	
	// la petición debería ser atómica: si falla algo, se haría un rollback
	// como solución de compromiso, hago las actualizaciones en la representación del recurso (objr) 
	// y encolo aquí las inserciones y borrados a hacer	
	const requests = [];
	
	// incluyo la iri del recurso del patch (ya que no se hace en applyPatch)
	objcache.mods.add(iri);
	
	// itero por cada elemento del patch
	for (let i=0; i<patch.length; i++) {
		// obtengo patch element y obtengo triplas a insertar/borrar por endpoint
		const pe = patch[i];
		try {
			requests.push(applyPatch(iri, objr, pe, mel, api, objcache));
		} catch(err) {
			if (err.status != null && err.status === 400)
				err.message = err.message + ' at patch[' + i +']';
			throw err;
		}
	}	

	/* for (const req of requests) {
		for (const epid in req.edt) {
			if (req.edt[epid].length > 0) { 
				console.log(`Triplas borrar endpoint "${epid}":`);
				console.log(req.edt[epid]);
			}
		}
		for (const epid in req.eit) {
			if (req.eit[epid].length > 0) { 
				console.log(`Triplas insertar endpoint "${epid}":`);
				console.log(req.eit[epid]);
			}
		}
	}*/
	
	// resuelvo las inserciones / modificaciones en el orden pedido
	for (let i=0; i<requests.length; i++) {
		//console.log("PATCH #"+i);
		const request = requests[i];
		// hago los delete correspondientes
		for (const epid in request.edt) {
			if (request.edt[epid].length > 0) {
				// preparo la consulta
				const qt = {
					template : getUpdateOperation(false, request.edt[epid]),
					endpoint : `${epid}_update`
				};
				// pido el borrado
				await dataManager.answerQuery(api, qt, {}, qinfo);
				// actualizo datos a devolver
				resp.deletedTriples += request.edt[epid].length;
				resp.numberOfQueries++;
			}
		}		
		// hago los insert correspondientes
		for (const epid in request.eit) {
			if (request.eit[epid].length > 0) {
				// preparo la consulta
				const qt = {
					template : getUpdateOperation(true, request.eit[epid]),
					endpoint : `${epid}_update`
				};
				// pido la inserción
				await dataManager.answerQuery(api, qt, {}, qinfo);
				// actualizo datos a devolver
				resp.insertedTriples += request.eit[epid].length;
				resp.numberOfQueries++;
				
			}
		}		
	}
	
	// tras modificar los triplestores, actualizamos la cache
	dataManager.deleteReferencesCache(api, objcache);
	
	// y que borre todas las consultas cacheadas de la api
	dataManager.cleanAPICache(api.config.apiId, true);
	
	// y hemos terminado
	return resp;
}



// FUNCIONES AUXILIARES
function applyPatch(iri, objr, pe, mel, api, objcache) {
	// inicializo modificaciones a hacer
	const resp = {
		edt: {},
		eit: {}
	};
	for (const ep of api.config.endpoints) {
		resp.edt[ ep.id ] = [];
		resp.eit[ ep.id ] = [];
	};

	// obtengo datos del path
	const tokens = pe.path.split("/");
	const key = tokens[1].replace(/~1/g, '/').replace(/~0/g, '~');
	const ind = tokens[2] == null?
		null : tokens[2].replace(/~1/g, '/').replace(/~0/g, '~'); // cuidado, ind es una cadena
			
	// 2021-11-05 trabajo aquí con melext para manejar bien las herencias
	const melext = dataManager.getExtendedMel(api, mel);
	
	// obtengo el subelemento al que aplica key
	const subel = melext.types.find(el => el.label === key) ??
		melext.props.find(el => el.label === key);
	
	//console.log("\nDatos básicos path:\n - path: " + pe.path + "\n - op: " + pe.op);
		
	// si no existe el miembro en el objeto...
	if (objr[key] == null) {
		//console.log("Operación sobre miembro inexistente en " + key); //
	
		if (pe.op !== 'add'|| ind != null) {
			// error en la petición
			const err = new Error('Undefined member ' + key + ' in the target resource');
			err.status = 400;
			throw err;
		} else { // petición 'add' a un miembro	=> sólo inserción		
			// actualizo primero objr
			objr[key] = pe.value;	
			// obtengo las triplas de inserción (y actualizo objcache)
			getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, api, objcache);
		}
	} else { // existe el miembro		
		// si el path no es un array...
		if (ind == null) {
			// console.log("Operación sobre miembro " + key);
		
			// obtengo las triplas de borrado (común)		
			getSubelementEndpointTriples(resp.edt, false, iri, objr, subel, api, objcache);
			// trato bifurcación
			if (pe.op === 'remove') 
				delete objr[key]; // sólo tengo que borrar el miembro
			else { // en este caso son equivalentes 'add' y 'replace'
				// actualizo primero objr
				objr[key] = pe.value;	
				// obtengo las triplas de inserción (y actualizo objcache)
				getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, api, objcache);
			}
		} else { // el path es un array => operación sobre un elemento de una colección
			// console.log("Operación sobre elemento de array en " + key + "[" + ind + "]");		
			
			// convierto en array si es necesario
			if (!Array.isArray(objr[key]))
				objr[key] = [ objr[key] ];
			
			// el truqui será cambiarle el miembro a objr y luego apañárselo
			const prevmember = objr[key]; // guardo lo que había				
			
			if (ind === '-') { // 'add' de un elemento al final
				// le enchufo como nuevo miembro el valor a insertar al final
				objr[key] = pe.value;
				// obtengo las triplas de inserción (y actualizo objcache)
				getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, api, objcache);
				// actualizo objr con el nuevo elemento
				objr[key] = prevmember;
				objr[key].push(pe.value);
			} else {
				// compruebo si hay problemas con el índice
				const pind = Number(ind);
				if (pind >= objr[key].length) { // tiene que existir
					// error en la petición
					const err = new Error('Undefined member ' + key + '[' + pind + '] in the target resource');
					err.status = 400;
					throw err;
				}
				// actualizo
				if (pe.op !== 'add') {
					// le enchufo como miembro el valor a borrar
					objr[key] = objr[key][pind];
					// obtengo las triplas de borrado (común)		
					getSubelementEndpointTriples(resp.edt, false, iri, objr, subel, api, objcache);
					// trato bifurcación
					if (pe.op === 'remove') {
						// actualizo objr (sólo tengo que borrar el valor del array en pind)
						objr[key] = prevmember;
						objr[key].splice(pind, 1);
					} else { // 'replace'
						// actualizo primero objr con el valor a insertar
						objr[key] = pe.value;
						// obtengo las triplas de inserción (y actualizo objcache)
						getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, api, objcache);
						// actualizo objr (sólo tengo que reemplazar el valor del array en pind)
						objr[key] = prevmember;
						objr[key].splice(pind, 1, pe.value);
					}				
				} else { // es un 'add'
					// actualizo primero objr con el valor a insertar
					objr[key] = pe.value;
					// obtengo las triplas de inserción (y actualizo objcache)
					getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, api, objcache);
					// actualizo objr (sólo tengo que insertar el valor del array en pind)
					objr[key] = prevmember;
					objr[key].splice(pind, 0, pe.value);				
				}
			}		
		}		
	}	
	
	// devuelvo las triplas a borrar/insertar por endpoint
	return resp;
}


function getUpdateOperation(esInsert, triples) {
	let prevtriple = null;
	let request = esInsert? "INSERT DATA {\n" : "DELETE DATA {\n";
	for (let i=0; i<triples.length; i++) {
		let triple = triples[i];
		if (prevtriple == null)
			request += triple.s + " " + triple.p + " " + triple.o;
		else {
			if (triple.s !== prevtriple.s) // si no comparten sujeto
				request += " .\n" + triple.s + " " + triple.p + " " + triple.o;
			else if (triple.p === prevtriple.p) // comparten sujeto y predicado
				request += " ,\n    " + triple.o;
			else // comparten sujeto
				request += " ;\n  " + triple.p + " " + triple.o;				
		}
		prevtriple = triple;
	}
	request += " .\n}";
	return request;
}


function getTriple(iri, valor, subel, objcache) {
	// inicializo la tripla	con el sujeto
	const tripla = {
		s: '<' + iri + '>'
	};
	
	// analizo predicado, dependiendo del tipo de subel
	let inversa = false;
	// caso type
	if (subel.proptype == null)
		tripla.p = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
	else {
		// extraigo la propiedad
		let prop = subel.propiri; // caso fácil
		if (subel.propexpr) {
			// sólo permito <iri> y ^iri
			const regexp = subel.propexpr.match(/^(\^)?<([^>]+)>$/);
			if (!regexp)
				return null;			
			inversa = regexp[1] != null;
			prop = regexp[2];
		}
		// guardo el predicado	
		tripla.p = '<' + prop + '>';
	}
	
	// analizo objeto, caso type u object prop
	if (subel.proptype == null || subel.proptype == "object") {
		// obtengo la iri objeto de manera diferente si hay algo embebido o no
		const oiri = typeof valor === "object"? valor.iri : valor;
		tripla.o = '<' + oiri + '>';
		
		// incluyo ref en objcache
		objcache.refs.add(oiri);
		//borrar[oiri] = true;
		
		// si es inversa... (sólo aplicaría en oprop)
		if (inversa) {
			const oaux = tripla.s;
			tripla.s = tripla.o;
			tripla.o = oaux;
		}	
	}
	else { // caso datatype
		// 2023-11-28 hago escapado de cadenas: https://www.w3.org/TR/turtle/#turtle-literals
		// guardo el literal de manera apropiada en el objeto
		if (typeof valor === "object") { // string con language tag
			const mikey = Object.keys(valor)[0];
			// esto es para evitar el caso improbable de que incluya ''', siendo sustituido por '' '
			// además, sustituyo el "'" final por "' " para que no dé problemas virtuoso
			const mivalue = valor[mikey].replaceAll( "'''" , "'' '" )
				.replace(new RegExp("'$"), "' ");
			// 2023-06-26 cuidado con nolang en el language tag
			if (mikey === config.nolang)
				tripla.o = "'''" + mivalue + "'''";
			else
				tripla.o = "'''" + mivalue + "'''@" + mikey;
		}
		// 2023-07-12 incluyo caso del booleano
		else if (typeof valor === "boolean")
			tripla.o = valor? '"true"^^xsd:boolean' : '"false"^^xsd:boolean';
		else if (typeof valor === "string") {
			// 2023-12-12 incluyo detección de URI
			// compruebo si es una fecha
			if ( !isNaN(Date.parse(valor)) )
				tripla.o = '"' + valor + '"^^xsd:dateTime';
			else {
				// pruebo si es una URI
				try {
					// lanza una excepción si iri no está bien formada: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
					new URL(valor);
					// además, obligo a que empiece por http/s
					if (!valor.startsWith('http://') && !valor.startsWith('https://'))
						throw new Error(); // voy al catch
					// es una URI
					tripla.o = '"' + valor + '"^^<http://www.w3.org/2001/XMLSchema#anyURI>';	
				} catch(error) {
					// es una cadena, hago escapados de antes
					const mivalue = valor.replaceAll( "'''" , "'' '" )
						.replace(new RegExp("'$"), "' ");
					tripla.o = "'''" + mivalue + "'''";
				} 
			}
		}
		else
			tripla.o = valor;
	}
	// devuelvo la tripla
	return tripla;
}


function getSubelementEndpointTriples(et, insert, iri, objr, subel, api, objcache) {
	const ep = api.endpointsById[subel.endpoint];
	
	if (ep.sparqlUpdate == null) // comprobación actualizable
		return;
 
	if (objr[subel.label] == null) // comprobación representación existente
		return;
		
	// obtengo elemento del modelo embebido, si lo hay
	const embmel = subel.targetId != null? api.modelById[subel.targetId] : null;
	
	// formateo valores como array si hace falta
	let valores = objr[subel.label];
	if (!Array.isArray(valores)) // convierto en array
		valores = [ valores ];
	
	// para cada valor preparo una tripla y procesa posibles embebidos
	for (const valor of valores) {
		// obtengo la tripla (aquí se incluirán las refs en objcache)
		const tripla = getTriple(iri, valor, subel, objcache);				
		// incluyo la tripla
		if (tripla != null)
			et[ep.id].push(tripla);
		
		// si es una inserción, hay targetId y hay info embebida, recupero sus triplas a insertar
		if (insert && embmel != null && valor != null && typeof valor === "object") {
			const embeit = getEndpointTriples(insert, valor.iri, valor, embmel, api, objcache);
			for (const embepid in embeit) {
				if (embeit[embepid].length > 0)
					et[embepid].push(...embeit[embepid]);				
			}
		}		
	}
}


function getEndpointTriples(insert, iri, objr, mel, api, objcache) {
	// incluyo la iri del recurso a borrar/crear/modificar
	objcache.mods.add(iri);

    // inicializo objeto a devolver
    const et = {};
    for (const endpoint of api.config.endpoints)
        et[endpoint.id] = [];

    // 2021-11-05 trabajo aquí con melext para manejar bien las herencias
    const melext = dataManager.getExtendedMel(api, mel);

    // analizo types y props
    // no permito joins
	for (const collection of [melext.types, melext.props]) {
		for (const item of collection) {
            getSubelementEndpointTriples(
                et,
                insert,
                iri,
                objr,
                item,
                api,
                objcache
            );
		}
	}

    // ordeno y quito triplas duplicadas
    for (const epid of Object.keys(et)) {
        if (et[epid].length > 0) {
			// ordeno triplas
            et[epid].sort((a, b) =>
                `${a.s}${a.p}${a.o}`.localeCompare(
                    `${b.s}${b.p}${b.o}`
                )
            );
			// quito triplas duplicadas
            et[epid] = et[epid].filter(
                (el, idx, arr) =>
                    idx === 0 ||
                    `${arr[idx - 1].s}${arr[idx - 1].p}${arr[idx - 1].o}` !==
                    `${el.s}${el.p}${el.o}`
            );
        }
    }

    return et;
}


module.exports = {
	putResource,
	deleteResource,
	patchResource
}