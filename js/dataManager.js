const _ = require('underscore');
const config = require('../data/config');
const sparqlClient = require('./sparqlClient');
const queryTemplates = require('../data/queryTemplates'); // para preparar las consultas
const util = require('./util'); // para el hash de las consultas

const pagina = 100; // paginación de consultas

let cachedQueries = {};

// FUNCIÓN PARA PROBAR QUE FUNCIONA EL ENDPOINT
async function testEndpoint(endpoint, qtid, qinfo) {
	// hago consulta de prueba
	var qtemp = _.find(queryTemplates.queryTemplates, el => el.id === qtid );
	await sparqlClient.queryEndpoint(endpoint, qtemp.template, {}, qinfo);	
	// fue todo bien
	return;
}

// FUNCIÓN PARA RESPONDER A UNA CONSULTA PARAMETRIZADA
async function answerQuery(endpoint, qtemp, aux, qinfo) {
	// 2021-02-02: cacheo consultas
	// 2021-07-12: reajusto el cacheo de consultas, agrupando por cada uri del punto sparql (esuri)
	// preparo objeto con las consultas del endpoint si hace falta
	const esuri = endpoint.sparqlURI;
	if (cachedQueries[esuri] == undefined)
		cachedQueries[esuri] = {};

	// obtengo el hash de las consultas
	const objaux = {
		ep: endpoint,
		qt: qtemp,
		au: aux
	}
	const hash = util.getHash(objaux);

	// si no está cacheada hay que hacer la consulta...
	if (cachedQueries[esuri][hash] == undefined) {
		cachedQueries[esuri][hash] = {}; // inicializo
		cachedQueries[esuri][hash].datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, qinfo);
		cachedQueries[esuri][hash].timestampCache = new Date().getTime();		
	}
	// devuelvo los datos
	return cachedQueries[esuri][hash].datos;
}

// FUNCIÓN PARA LIMPIAR LA CACHÉ DE CONSULTAS POR THRESHOLD
function cleanCachedQueries(timeThreshold) {
	// obtengo timestamp límite para borrar de la caché
	const timeNow = new Date().getTime();
	// inicializo
	let summary = {
		inspected: 0,
		cleaned: 0		
	};
	// itero por cada esuri
	for (let esuri in cachedQueries) {
		// consultas a borrar
		let hashesBorrar = [];	
		for (let hash in cachedQueries[esuri]) {
			summary.inspected++; // una consulta más inspeccionada...
			if (cachedQueries[esuri][hash].timestampCache < timeThreshold)
				hashesBorrar.push(hash); // incluyo en la lista de borrrados
		}
		// actualizo borrados
		summary.cleaned += hashesBorrar.length;
		// y los borro de la caché
		for (let i=0; i<hashesBorrar.length; i++)
			delete cachedQueries[esuri][hashesBorrar[i]];	
	}	
	return summary;
}

// FUNCIÓN PARA LIMPIAR LA CACHÉ DE CONSULTAS POR ENDPOINT
// se usa en las escrituras para limpiar las consultas cacheadas
function cleanCachedQueriesEndpoint(esuri) {
	cachedQueries[esuri] = {};
}


// FUNCIÓN GENERAL PARA OBTENER DATOS
// obtengo datos de un conjunto de iris de un determinado tipo
// se utiliza el modelo de la caché para ver qué datos extraer
async function getData(obj, qinfo, writeonlytoo) {
	// 2021-mar modificación para tipos de elementos writeonly
	if (writeonlytoo == undefined)
		writeonlytoo = false;

	// compruebo si el tipo de datos existe en el modelo
	let mel = _.find(obj.api.config.model, (el) => el.id === obj.id);
	if (mel == undefined)
		throw Error("Check your model, incorrect data type => " + obj.id);
		
	// tipo correcto, pido los datos
	let salida = await extractResources(obj.iris, mel, obj.api, qinfo, writeonlytoo);
		
	// ahora genero la salida deseada
	salida.data = await createRepresentations(obj.iris, mel, obj.api, writeonlytoo);
	
	// devuelvo la salida
	return salida;
}



// FUNCIONES PARA FORMATEAR LA SALIDA
async function createRepresentations(iris, mel, api, writeonlytoo) {
	//console.log('Incluyendo ' + iris.length + ' recursos de tipo "' + mel.id + 
	//	'" de la API "' + api.config.apiId + '" en la salida');	
	// preparo objeto con la salida
	let obj = [];
	for (let i=0; i<iris.length; i++) {
		let ent = formatResource(iris[i], mel, api, writeonlytoo);
		if (ent != null)
			obj.push( ent );
	}		
	return obj;
}

function formatResource(iri, mel, api, writeonlytoo) {
	// recupero entidad de la caché
	let ent = api.cache[mel.id][iri];
	if (ent == undefined)
		return null;

	// preparo objeto a devolver
	var obj = { iri: iri };	
	
	// incluyo types
	for (let i=0; i<mel.types.length; i++) {
		let ttype = mel.types[i];
		// compruebo si debo incluir ttype según writeonlytoo
		if (writeonlytoo || ttype.writeonly == undefined || !ttype.writeonly) {
			if ( ent[ttype.label].length > 0 ) { // incluyo sólo si hay algo
				// si no hay targetId y embed, me quedo simplemente con la lista
				if (ttype.targetId == undefined || ttype.embed == undefined || !ttype.embed)
					obj[ttype.label] = _.clone(ent[ttype.label])
				else {	// construyo la lista de elementos a incluir
					obj[ttype.label] = [];
					let evmel = _.find(api.config.model, (el) => el.id === ttype.targetId);	
					for (let j=0; j<ent[ttype.label].length; j++) {
						let eviri = ent[ttype.label][j];
						evobj = formatResource(eviri, evmel, api);
						if (evobj != null)
							obj[ttype.label].push(evobj);
						else // no existe el recurso destino, simplemente preparo un objeto con la iri
							obj[ttype.label].push( { "iri": eviri} );
					}			
				}
				// refinamiento: si el resultado es una lista con un objeto, quito la lista y me quedo con el objeto
				if (obj[ttype.label].length == 1)
					obj[ttype.label] = obj[ttype.label][0];
			}
		}
	}
	
	// incluyo data properties
	for (let i=0; i<mel.dprops.length; i++) {
		let dprop = mel.dprops[i];
		// compruebo si debo incluir dprop según writeonlytoo
		if (writeonlytoo || dprop.writeonly == undefined || !dprop.writeonly) {
			// si tengo un solo objeto, prescindo del array
			if (ent[dprop.label].length == 1)
				obj[dprop.label] = _.clone( ent[dprop.label][0] );
			else if (ent[dprop.label].length > 1) // si hay varios, clono el array
				obj[dprop.label] = _.clone( ent[dprop.label] );
			// si no hay nada, pues no lo guardo
		}
	}
	
	// incluyo object properties (recursivo)
	for (let i=0; i<mel.oprops.length; i++) {
		let oprop = mel.oprops[i];
		// compruebo si debo incluir dprop según writeonlytoo
		if (writeonlytoo || oprop.writeonly == undefined || !oprop.writeonly) {
			if ( ent[oprop.label].length > 0 ) { // incluyo sólo si hay algo
				// si no hay targetId y embed, me quedo simplemente con la lista
				if (oprop.targetId == undefined || oprop.embed == undefined || !oprop.embed)
					obj[oprop.label] = _.clone(ent[oprop.label])
				else {	// construyo la lista de elementos a incluir
					obj[oprop.label] = [];
					let evmel = _.find(api.config.model, (el) => el.id === oprop.targetId);	
					for (let j=0; j<ent[oprop.label].length; j++) {
						let eviri = ent[oprop.label][j];
						evobj = formatResource(eviri, evmel, api);
						if (evobj != null)
							obj[oprop.label].push(evobj);
						else // no existe el recurso destino, simplemente preparo un objeto con la iri
							obj[oprop.label].push( { "iri": eviri} );
					}			
				}
				// refinamiento: si el resultado es una lista con un objeto, quito la lista y me quedo con el objeto
				if (obj[oprop.label].length == 1)
					obj[oprop.label] = obj[oprop.label][0];
			}
		}
	}
	return obj;
}



// FUNCIONES DE EXTRACCIÓN DE DATOS
// (si no están en la caché de la API se piden al cliente SPARQL)
async function extractResources(iris, mel, api, qinfo, writeonlytoo) {	
	// creo primero los recursos si no existen en la caché de la api
	let target = api.cache[mel.id];
	_.each(iris, function(iri) {
		if (target[iri] == undefined) {
			target[iri] = { 
				"iri" : iri ,
				"timestampCache" : new Date().getTime() // 01-02-2021 incluido para el control de la caché
			};
		}
	});
				
	// array de promesas para obtener los datos (en cascada)
	let promesas = [];
	
	// una promesa para cada tipo
	_.each( mel.types, (ttype) => {
		// compruebo si debo incluir ttype según writeonlytoo
		if (writeonlytoo || ttype.writeonly == undefined || !ttype.writeonly)
			promesas.push( extractType(iris, mel.id, ttype, api, qinfo) );
	});
	// una promesa para la lista de dataprops
	const dprops = _.filter(mel.dprops, function(el) { return writeonlytoo || el.writeonly == undefined || !el.writeonly; });
	promesas.push( extractDataProps(iris, mel.id, dprops, api, qinfo) );
	// una promesa por cada objectprop
	_.each( mel.oprops, (oprop) => {
		// compruebo si debo incluir oprop según writeonlytoo
		if (writeonlytoo || oprop.writeonly == undefined || !oprop.writeonly)
			promesas.push( extractObjectProp(iris, mel.id, oprop, api, qinfo) );
	});
	
	// espero a que terminen todas...
	let resps = await Promise.all(promesas);

	// obtengo el número de consultas
	let nc = {
		numberOfQueries: 0,
		allQueries: 0	
	};
	for(let i=0; i<resps.length; i++) 
		nc.numberOfQueries += resps[i];
	nc.allQueries = estimateTotalQueries(iris, mel, api, writeonlytoo);
	
	// devuelvo el número de consultas
	return nc;
}


// estimación total de consultas necesarias sin caché
// se realiza una vez obtenidos todos los datos
function estimateTotalQueries(iris, mel, api, writeonlytoo) {	
	let tnc = 0; // valor de retorno
	
	// obtengo número de consultas por bloque
	let nqb = Math.floor(iris.length / pagina);
	if (iris.length % pagina != 0)
		nqb++;
	tnc += nqb * mel.types.length; // consultas de tipos
	tnc += nqb * mel.dprops.length; // consultas de data properties
	tnc += nqb * mel.oprops.length; // consultas de object properties
	
	// si no es writeonly hay que restar los elementos no recuperados...
	if (!writeonlytoo) {
		let nrestar = _.filter(mel.types, function(el) { return el.writeonly != undefined || el.writeonly; }).length;
		nrestar += _.filter(mel.dprops, function(el) { return el.writeonly != undefined || el.writeonly; }).length;
		nrestar += _.filter(mel.oprops, function(el) { return el.writeonly != undefined || el.writeonly; }).length;
		tnc -= nqb * nrestar;
	}
	
	// trato la recursión 	
	let target = api.cache[mel.id];		
	// recursión de los tipos
	_.each( mel.types, (ttype) => {
		if (writeonlytoo || ttype.writeonly == undefined || !ttype.writeonly) {
			if (ttype.targetId != undefined && ttype.embed != undefined && ttype.embed) {
				// tipo recursivo, obtengo nuevas iris y nuevo mel
				let evmel = _.find(api.config.model, (el) => el.id === ttype.targetId);
				let eviris = [];
				_.each( iris, (iri) => {
					eviris = _.union(eviris, target[iri][ttype.label]);
				});
				tnc += estimateTotalQueries(eviris, evmel, api);
			}
		}
	});	
	// recursión de los object properties
	_.each( mel.oprops, (oprop) => {
		if (writeonlytoo || oprop.writeonly == undefined || !oprop.writeonly) {
			if (oprop.targetId != undefined && oprop.embed != undefined && oprop.embed) {
				// propiedad recursiva, obtengo nuevas iris y nuevo mel
				let evmel = _.find(api.config.model, (el) => el.id === oprop.targetId);
				let eviris = [];
				_.each( iris, (iri) => {
					eviris = _.union(eviris, target[iri][oprop.label]);
				});
				tnc += estimateTotalQueries(eviris, evmel, api);
			}
		}
	});
	
	return tnc;
}


async function extractType(iris, id, ttype, api, qinfo) {
	// recupero el objeto target de la caché de la API
	let target = api.cache[id];
	
	// número de consultas
	let nc = 0;
		
	/*
	// preparo iris de las entidades destino a procesar tras finalizar... (sólo si hay target y embed)
	let retargets = [];*/
	
	// obtengo lista de recursos sin tipo
	let eviris = [];
	_.each(iris, function(iri) {
		// si no existe el tipo, adentro
		if (target[iri][ttype.label] == undefined)
			eviris.push(iri);
	});
	
	// hago peticiones con lotes de 100 iris en secuencia
	while (eviris.length > 0) {
		let iriset = eviris.splice(0, pagina);
		// preparo objeto auxiliar para la consulta
		let aux = {};
		aux.inferred = ttype.inferred;
		aux.restrictions = ttype.restrictions;
		aux.iris = [];
		aux.firis = []; 
		_.each(iriset, function(iri) {
			aux.iris.push(iri);
			aux.firis.push("<"+iri+">");
		});
		// preparo resto de parámetros para hacer la consulta
		let qtemp = _.find(queryTemplates.queryTemplates, el => el.id === 'types' ); // consulta tipo types
		const endpoint = _.find(api.config.endpoints, el => el.id === ttype.endpoint );
		
		// espero a tener los resultados...
		const datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, qinfo); //, api.config.prefixes);
		
		// 5/3/21 para evitar problemas de concurrencia guardo los resultados en un objeto local y luego actualizo
		let objaux = {};
		// inicializo para cada iri un array
		_.each(aux.iris, function(iri) {
			objaux[iri] = [];
		});
		// proceso los resultados en objaux
		_.each(datos.results.bindings, function(row) {
			// recupero datos y almaceno
			const miiri = row.iri.value;
			const mitype = row.type.value;
			objaux[miiri].push(mitype);
		});
		// y ahora guardo en el sitio adecuado de la caché
		_.each(aux.iris, function(iri) {
			target[iri][ttype.label] = objaux[iri];
		});
		
		// incremento consultas
		nc++;
	}
		
	// proceso los retargets si hay targetId y embed
	if (ttype.targetId != undefined && ttype.embed != undefined && ttype.embed) {
		//console.log("Procesando retargets " + oprop.target);
	
		// pido extraer la remesa de retargets
		let mel = _.find(api.config.model, (el) => el.id === ttype.targetId);
		if (mel == undefined)
			throw Error("Check your model, incorrect data type => " + ttype.targetId);
		
		// obtengo retargets (no lo puedo hacer antes por si hubiera habido algún error, requiriendo su recálculo)
		let retargets = [];
		_.each(iris, function(iri) {
			retargets = retargets.concat(target[iri][ttype.label]);
		});		
		
		// los retargets deben ser únicos
		retargets = _.uniq(retargets);
		
		//console.log("Procesando retargets " + oprop.targetId + " - total: " + retargets.length);
		
		// extraigo (recursivo) y agrego consultas
		let resp = await extractResources(retargets, mel, api, qinfo);
		nc += resp.numberOfQueries;
	}
	
	return nc; // aquí hemos terminado
}

async function extractDataProps(iris, id, dprops, api, qinfo) {
	// recupero el objeto target de la caché de la API
	let target = api.cache[id];
	
	// número de consultas
	let nc = 0;
	
	// proceso cada propiedad
	for (let i=0; i<dprops.length; i++) {
		const dprop = dprops[i];		
				
		// lista de iris sin valores de dprop
		let eviris = [];
		// analizo si existen los recursos y las propiedades
		_.each(iris, function(iri) {
			// si no existe la propiedad, adentro
			if (target[iri][dprop.label] == undefined)
				eviris.push(iri);
		});

		// preparo lotes de 100 iris
		while (eviris.length > 0) {
			let iriset = eviris.splice(0, pagina);
			// preparo objeto auxiliar para la consulta
			let aux = {};
			aux.propiri = dprop.iri;
			aux.restrictions = dprop.restrictions;
			aux.iris = [];
			aux.firis = []; 
			_.each(iriset, function(iri) {
				aux.iris.push(iri);
				aux.firis.push("<"+iri+">");
			});
			// preparo resto de parámetros para hacer la consulta
			let qtemp = _.find(queryTemplates.queryTemplates, el => el.id === 'propvalues' ); // consulta tipo propvalues
			const endpoint = _.find(api.config.endpoints, el => el.id === dprop.endpoint );				
						
			// espero a tener los resultados...
			const datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, qinfo); //, api.config.prefixes);
			
			// 5/3/21 para evitar problemas de concurrencia guardo los resultados en un objeto local y luego actualizo
			let objaux = {};
			// inicializo para cada iri un array
			_.each(aux.iris, function(iri) {
				objaux[iri] = [];
			});
			// proceso los resultados en objaux
			_.each(datos.results.bindings, function(row) {
				// obtengo datos
				var eviri = row.iri.value;
				var value = row.value;
				// si es un número sólo guardo el valor en el array
				if (value.type === "typed-literal") {
					// guardo como número si puedo (si no, como esté)
					const valor = isNaN(Number(value.value))? value.value : Number(value.value);
					objaux[eviri].push( valor );
				}
				// si es un literal guardo en el array un objeto con clave la etiqueta de lenguaje y valor el literal
				else if (value.type === "literal") {
					var lang = value["xml:lang"] == undefined? config.nolang : value["xml:lang"];
					let lit = {};
					lit[lang] = value.value;
					objaux[eviri].push( lit );			
				}
				// no incluyo iris ni blank nodes
			});
			// y ahora guardo en el sitio adecuado de la caché
			_.each(aux.iris, function(iri) {
				target[iri][dprop.label] = objaux[iri];
			});
			
			// incremento consultas
			nc++;
		}
	}
	
	return nc; // aquí hemos terminado
}

async function extractObjectProp(iris, id, oprop, api, qinfo) {
	// recupero el objeto target de la caché de la API
	let target = api.cache[id];
	
	// número de consultas
	let nc = 0;
		
	// lista de iris sin valores de dprop
	let eviris = [];
	// analizo si existen los recursos y las propiedades
	_.each(iris, function(iri) {
		// si no existe la propiedad, adentro
		if (target[iri][oprop.label] == undefined)
			eviris.push(iri);
	});
		
	// preparo lotes de 100 iris
	while (eviris.length > 0) {
		let iriset = eviris.splice(0, pagina);
		// preparo objeto auxiliar para la consulta
		let aux = {};
		aux.propiri = oprop.iri; // la IRI de la propiedad
		aux.inv = oprop.inv; // si es propiedad invertida...
		aux.restrictions = oprop.restrictions; // las restricciones
		aux.iris = [];
		aux.firis = []; 
		_.each(iriset, function(iri) {
			aux.iris.push(iri);
			aux.firis.push("<"+iri+">");
		});
		// preparo resto de parámetros para hacer la consulta
		let qtemp = _.find(queryTemplates.queryTemplates, el => el.id === 'propvalues' ); // consulta tipo propvalues
		const endpoint = _.find(api.config.endpoints, el => el.id === oprop.endpoint );	
		
		// espero a tener los resultados...
		let datos = await sparqlClient.queryEndpoint(endpoint, qtemp.template, aux, qinfo); //, api.config.prefixes);
						
		// 5/3/21 para evitar problemas de concurrencia guardo los resultados en un objeto local y luego actualizo
		let objaux = {};
		// inicializo para cada iri un array
		_.each(aux.iris, function(iri) {
			objaux[iri] = [];
		});
		// proceso los resultados en objaux
		_.each(datos.results.bindings, function(row) {
			// obtengo datos
			var eviri = row.iri.value;
			var value = row.value;
			// object property?
			if (value.type === "uri") // guardo valor
				objaux[eviri].push(value.value);
			// no incluyo literales ni blank nodes
		});
		// y ahora guardo en el sitio adecuado de la caché
		_.each(aux.iris, function(iri) {
			target[iri][oprop.label] = objaux[iri];
		});
		
		// incremento consultas
		nc++;
	}
	
	// proceso los retargets si hay targetId y embed
	if (oprop.targetId != undefined && oprop.embed != undefined && oprop.embed) {
		//console.log("Procesando retargets " + oprop.target);
	
		// pido extraer la remesa de retargets
		let mel = _.find(api.config.model, (el) => el.id === oprop.targetId);
		if (mel == undefined)
			throw Error("Check your model, incorrect data type => " + oprop.targetId);
		
		// obtengo retargets (no lo puedo hacer antes por si hubiera habido algún error, requiriendo su recálculo)
		let retargets = [];
		_.each(iris, function(iri) {
			retargets = retargets.concat(target[iri][oprop.label]);
		});		
		
		// los retargets deben ser únicos
		retargets = _.uniq(retargets);
		
		//console.log("Procesando retargets " + oprop.targetId + " - total: " + retargets.length);
		
		// extraigo (recursivo) y agrego consultas
		let resp = await extractResources(retargets, mel, api, qinfo);
		nc += resp.numberOfQueries;
	}
	
	return nc; // aquí hemos terminado
}


module.exports = {
	testEndpoint,
	answerQuery,
	getData,
	cleanCachedQueries,
	cleanCachedQueriesEndpoint
}