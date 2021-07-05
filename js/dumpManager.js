const _ = require('underscore');
const config = require('../data/config'); // para las URLs y locations
const logger = require('./logger'); // para el logging
const dataManager = require('./dataManager'); // para los datos
const util = require('./util'); // para ficheros y generación de hash

const dirDumpPath = './' + config.dumpsPath + '/';

// objeto con el índice de los dumps por API (accesibles por clave)
var dumpIndexApi = {};


// INICIALIZACIÓN DEL ÍNDICE DE UNA API
async function initApi(apiId) {
	// inicializo el índice de la API
	const ldpath = dirDumpPath + apiId + config.listDumpFileEnding;
	dumpIndexApi[apiId] = []; // vacío si no hay nada
	
	// compruebo si existe el fichero de índice
	let existe = await util.checkFile(ldpath);		
	if (existe) {		
		// cargo el índice
		try {
			dumpIndexApi[apiId] = await util.loadFile(ldpath);
			return;
		} catch(err) {
			// lanzo error
			throw new Error('Error loading the dump index of the API "' +apiId + '": ' + err.message);
		}		
	} else {
		// guardo la lista vacía
		await util.saveFile(ldpath, dumpIndexApi[apiId]);
		return;
	}
}

// BORRADO DE LOS DUMPS DE UNA API
async function deleteApi(apiId) {
	if (dumpIndexApi[apiId] != undefined) {
		// recorro índice de dumps para borrar cada uno
		for (let i=0; i<dumpIndexApi[apiId].length; i++) {
			const dumpid = dumpIndexApi[apiId][i].id;
			const dumpath = dirDumpPath + apiId + "_" + dumpid;			
			await util.deleteFile(dumpath);			
		}
		// borro ahora el fichero de índice
		const ldpath = dirDumpPath + apiId + config.listDumpFileEnding;		
		await util.deleteFile(ldpath);
		// por último elimino el objeto con el índice
		delete dumpIndexApi[apiId];
	}
	return;
}

// DEVOLVER EL PATH DEL LISTADO DE DUMPS DE UNA API
async function getListOfDumpsPath(apiId) {
	// preparo el path
	const ldpath = dirDumpPath + apiId + config.listDumpFileEnding;
	// compruebo si existe
	let existe = await util.checkFile(ldpath);
	if (existe) // devuelvo el path
		return ldpath; 
	else
		return null;
}


// DEVOLVER EL PATH DEL DUMP DE UNA API
async function getDumpPath(apiId, dumpid) {
	// preparo el path
	const path = dirDumpPath + apiId + "_" + dumpid;
	// compruebo si existe
	let existe = await util.checkFile(path);
	if (existe) // devuelvo el path
		return path; 
	else
		return null;
}

// BORRAR UN DUMP
async function deleteDump(apiId, dumpid) {
	if (dumpIndexApi[apiId] != undefined) {
		// obtengo el path del dump y lo borro
		const dumpath = dirDumpPath + apiId + "_" + dumpid;			
		await util.deleteFile(dumpath);	
			
		// actualizo dumps eliminando dumpid de la api		
		dumpIndexApi[apiId] = _.filter(dumpIndexApi[apiId], function(el) { return el.id !== dumpid; });
		// guardamos el fichero de índice
		const ldpath = dirDumpPath + apiId + config.listDumpFileEnding;
		await util.saveFile(ldpath, dumpIndexApi[apiId]);
	}
	return;
}

// PIDO CREAR DUMP SI ES QUE NO ESTÁ YA ENCOLADO
async function createDump(api, dc, qinfo) {
	// pido el hash de la configuración	
	const dumpid = util.getHash(dc);	
	// preparo el path del dump
	const path = dirDumpPath + api.config.apiId + "_" + dumpid;
	// obtengo localización y urlini
	const urlini = config.scheme + '://' + config.authority;
	const loc = config.prepath + '/' + config.apisPath + '/' + api.config.apiId 
		+ '/' + config.dumpsPath + '/' + dumpid;
	
	// compruebo si hay que crear el dump
	let existe = await util.checkFile(path);
	const del =_.find(dumpIndexApi[api.config.apiId], el => el.id === dumpid);	
	let crear = false; // inicializamos a false
	if (!existe)
		crear = true;
	else { 
		// compruebo info del índice por si hay que crearlo de nuevo		
		if (del == undefined)
			crear = true;
		else if (del.status === 'failed')
			crear = true;
	}
	
	// hay que crear el dump
	if (crear) {
		// si existe del hay que borrarlo del índice
		if (del != undefined)
			dumpIndexApi[api.config.apiId] = _.without(dumpIndexApi[api.config.apiId], del);
	
		// inicializo dump con los datos a guardar
		let dump = {};
		dump.id = dumpid;
		dump.location = loc;
		dump.url = urlini + loc;
		dump.status = 'scheduled';
		dump.config = dc;
		
		// guardamos el dump en el índice
		dumpIndexApi[api.config.apiId].push(dump);
		
		// me pongo a resolver la petición (sin esperar a que termine)
		generateDump(api, dump, qinfo);
		
		// guardo los datos iniciales
		await util.saveFile(path, dump);
	}
	
	// devuelvo la localización
	return loc;
}

// función principal en la que se genera el dump
async function generateDump(api, dump, qinfo) {
	const apiId = api.config.apiId;
	
	// inicializo mensaje de log
	let logmess = {};
	logmess.reqId = qinfo.quuid;
	logmess.dumpId = dump.id;
	logmess.apiId = apiId;
	logmess.location =	dump.location;
	
	// tomo tiempo inicial
	const timeIni = new Date();
	
	// incluyo info de control en el dump
	dump.status = 'started';
	dump.started = timeIni.toISOString();

	// inicializo resultados
	let results = [];
	const dc = dump.config;
	
	// resuelvo cada step
	for (let i=0; i<dc.steps.length; i++) {
		const step = dc.steps[i];
				
		// preparo objeto del step para la petición y resultados
		let objr = {};
		objr.id = step.id;
		objr.request = {};
		
		// resuelvo los parámetros (si los hay)
		for (const par in step.parameters) {		
			const value = step.parameters[par];
			if (value.source != undefined && value.source === "parameters") 
				objr.request[par] = dc.parameters[value.key];
			else if (value.source != undefined && value.source === "steps") { // recupero parámetro de un resultado intermedio (step)
				// recupero step al que se refiere
				const stepref = _.find(dc.steps, (el) => el.id === value.id);
				if (stepref != undefined) {
					// recupero resultados intermedios
					const resref = _.find(results, (el) => el.id === value.id);
					if (resref != undefined) {					
						// hay steps y resultados, obtengo el parámetro deseado según el tipo de step
						if (stepref.type === "resource") {
							const el = resref.data[value.key];
							if (el != undefined) {
								// obj.request[par] = el; // TODO previo
								// 24-4-21 actualización 
								// el sólo puede ser un literal o un array de literales
								if (Array.isArray(el) && typeof el[0] === 'object') // me quedo sólo con las iris
									obj.request[par] = _.pluck(el, "iri");
								else if (!Array.isArray(el) && typeof el === 'object') // me quedo sólo con la iri del objeto
									obj.request[par] = el.iri;
								else // guardo directamente el
									obj.request[par] = el;					
							}
						} else if (stepref.type === "resources") {
							let vpar = [];
							/* TODO previo
							// incluyo en el array cada valor encontrado
							for (let i=0; i<resref.data.length; i++) {
								const el = resref.data[i][value.key];
								if (el != undefined) // incluyo valor (o valores si el es un array)
									vpar.push(el);
							}*/
							// 24-4-21 actualización
							// incluyo en el array cada valor encontrado
							for (let i=0; i<resref.data.length; i++) {
								const el = resref.data[i][value.key];
								if (el != undefined) {// incluyo valor (o valores si el es un array)
									// el sólo puede ser un literal o un array de literales
									if (Array.isArray(el) && typeof el[0] === 'object') // me quedo sólo con las iris
										vpar.push( _.pluck(el, "iri") );
									else if (!Array.isArray(el) && typeof el === 'object') // me quedo sólo con la iri del objeto
										vpar.push( el.iri );
									else // guardo directamente el
										vpar.push( el );
								}
							}
							// compacto el array
							vpar = _.flatten(vpar);
							// elimino duplicados
							vpar = _.uniq(vpar);
							// guardo
							objr.request[par] = vpar;							
						} else if (stepref.type === "query") {
							// proceso la consulta para obtener el valor del parámetro
							let vpar = [];
							// analizo cada fila de la consulta
							for (let i=0; i<resref.data.results.bindings.length; i++) {
								const row = resref.data.results.bindings[i];									
								if (row[value.variable] != undefined) {
									// hay binding para la variable, incluyo según el tipo
									if (row[value.variable].type === "typed-literal")
										vpar.push( Number(row[value.variable].value) );
									else // hago lo mismo para uris y literales (prescindo aquí del tag)
										vpar.push(row[value.variable].value); 
								}									
							}
							// elimino duplicados
							vpar = _.uniq(vpar);
							// guardo
							objr.request[par] = vpar;							
						}
					}
				}			
			} // <- else if steps
			else
				objr.request[par] = value; // ya está definido el valor del parámetro
		}
		
		// resuelvo la petición	del step
		try {			
			switch(step.type) {
				case "resource":
					// convierto a petición de tipo "resources"
					if (objr.request.iri != undefined) {
						objr.request.iris = [];
						objr.request.iris.push(objr.request.iri);
					}
				case "resources":
					objr.request.api = api; // meto la API completa
					// espero y guardo datos
					let datos = await dataManager.getData(objr.request, qinfo);				
					objr.data = datos.data;
					break;
				case "query":				
					// recupero la plantilla de la consulta
					let qtemp = _.find(api.config.queryTemplates, (el) => el.id === objr.request.id);
					if (qtemp != undefined) {
						// obtengo endpoint
						const endpoint = _.find(api.config.endpoints, el => el.id === qtemp.endpoint);
						// obtengo prefijos
						//const prefixes = api.config.prefixes;
						// espero y guardo datos
						objr.data = await dataManager.answerQuery(endpoint, qtemp, objr.request, qinfo);
						//objr.data = await dataManager.answerQuery(endpoint, qtemp, objr.request, quuid, prefixes);
					}			
					break;
			}
		} catch(error) {
			// ¡falló el step! 
			
			// tomo tiempo final
			const timeFin = new Date();
			
			// actualizo el dump
			dump.status = 'failed';
			dump.error = error.message;
			dump.ended = timeFin.toISOString();
		
			try {
				// guardo el dump
				const path = dirDumpPath + apiId + "_" + dump.id;
				await util.saveFile(path, dump);
	
				// actualizo el índice
				delete dump.output; // elimino los datos del objeto a guardar en el índice
				dumpIndexApi[apiId].push(dump);
				// guardo el fichero de índice
				const ldpath = dirDumpPath + apiId + config.listDumpFileEnding;
				await util.saveFile(ldpath, dumpIndexApi[apiId]);
			} finally { 
				// preparo mensaje para el log y termino
				logmess.error = error.message;
				logmess.timeMilliseconds = timeFin - timeIni;
				logger.error(logmess);
				return;
			}
		}
		
		// guardo el objeto de resultados
		results.push(objr);
	}
	
	// preparo la salida
	let salida = {};	
	for (let i=0; i<dc.output.length; i++) {
		// obtengo el elemento de la salida
		let outel = dc.output[i];
		// si tiene source y label...
		if (outel.label != undefined && outel.source != undefined) {
			// obtengo primero el target para guardar los resultados a partir del label de outel
			let target = outel.label;				
			if (target != undefined) {
				// creo el array si hace falta
				if (salida[target] == undefined)
					salida[target] = [];
				// meto los resultados según la fuente
				if (outel.source === 'parameters') {
					let sal = dc.parameters[outel.key];
					if (sal != undefined) {
						if (Array.isArray(sal)) // si es un array...
							salida[target] = salida[target].concat(sal);
						else // si es un objeto o un literal
							salida[target].push(sal);
					}					
				} else if (outel.source === 'steps') {
					// recupero step al que se refiere
					const stepref = _.find(dc.steps, (el) => el.id === outel.id);
					if (stepref != undefined) {
						// recupero resultados intermedios
						const resref = _.find(results, (el) => el.id === outel.id);
						if (resref != undefined && resref.data != undefined) {
							if (Array.isArray(resref.data)) // si es un array...
								salida[target] = salida[target].concat(resref.data);
							else // si es un objeto o un literal
								salida[target].push(resref.data);							
						}
					}
				}
			}
		}		
	}
	
	// tomo tiempo final
	const timeFin = new Date();
	
	// guardo la salida en el dump y actualizo datos
	dump.output = salida;
	dump.status = 'finished';
	dump.ended = timeFin.toISOString();	
	
	// guardo el dump
	const path = dirDumpPath + apiId + "_" + dump.id;
	await util.saveFile(path, dump);
	
	// actualizamos el índice
	delete dump.output; // elimino los datos del objeto a guardar en el índice
	// si existía el dump en el índice lo eliminamos
	dumpIndexApi[apiId] = _.filter(dumpIndexApi[apiId], function(el) { return el.id !== dump.id; });
	// y ahora lo metemos
	dumpIndexApi[apiId].push(dump);	
	
	// guardamos el fichero de índice
	const ldpath = dirDumpPath + apiId + config.listDumpFileEnding;
	await util.saveFile(ldpath, dumpIndexApi[apiId]);	
	
	// termino con mensaje de log
	logmess.info = 'Dump generated';
	logmess.timeMilliseconds = timeFin - timeIni;
	logger.info(logmess);
}


module.exports = {
	initApi,
	deleteApi,
	getListOfDumpsPath,
	getDumpPath,
	createDump,
	deleteDump
}