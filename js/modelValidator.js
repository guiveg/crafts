const _ = require('underscore');
const dataManager = require('./dataManager');

const testiri = 'http://prueba.es';

// VALIDACIÓN DE LAS CONFIGURACIONES DE APIS
async function validateAPIConfig(apiconfig, qinfo) {	
	// me aseguro de que haya al menos un endpoint definido (el formato asegurado por openApiValidator)
	if (apiconfig.endpoints.length == 0)
		throw new Error("The configuration has NO endpoint");
		
	// compruebo que funcionen los endpoints definidos
	try {
		let promesas = [];
		let epus = [];		
		// pruebo cada endpoint
		for (let i=0; i<apiconfig.endpoints.length; i++) {		
			// comprobación de id no repetido
			for (let j=0; j<i; j++) {
				if (apiconfig.endpoints[i].id === apiconfig.endpoints[j].id)
					throw new Error('Duplicate id in endpoints[' + j + '] and endpoints[' + i + ']');
			}
			// e incluyo promesa "test"
			promesas.push( dataManager.testEndpoint(apiconfig.endpoints[i], "test", qinfo) );
			// si hay sparqlUpdate preparo configuración y hago peticiones de inserción y borrado de datos de prueba
			if (apiconfig.endpoints[i].sparqlUpdate != undefined) {
				// cojo referencias
				const ep = apiconfig.endpoints[i];
				let epu = apiconfig.endpoints[i].sparqlUpdate;
				// incluyo id con coletilla _update
				epu.id = ep.id + "_update";
				// replico info del endpoint contenedor si no estuviera incluida
				if (epu.sparqlURI == undefined && ep.sparqlURI != undefined)
					epu.sparqlURI = ep.sparqlURI;
				if (epu.graphURI == undefined && ep.graphURI != undefined)
					epu.graphURI = ep.graphURI;
				if (epu.httpMethod == undefined && ep.httpMethod != undefined)
					epu.httpMethod = ep.httpMethod;
				if (epu.authInfo == undefined && ep.authInfo != undefined)
					epu.authInfo = ep.authInfo;	
				// preparo promesa "testInsert"
				promesas.push( dataManager.testEndpoint(epu, "testInsert", qinfo) );
				// guardo epu para el borrado y dejar limpio el endpoint
				epus.push(epu);
			}
		}
		// espero a que terminen todas las promesas
		await Promise.all(promesas);
		// promesas de borrado
		promesas = [];
		for (let i=0; i<epus.length; i++) {
			const epu = epus[i];
			// preparo promesa "testDelete"
			promesas.push( dataManager.testEndpoint(epu, "testDelete", qinfo) );
		}
		// espero a que terminen todas las promesas
		await Promise.all(promesas);		
	} catch(err) {
		throw new Error('Some endpoint is not working: ' + err.message);
	}	
	
	// preparo un objeto para consultas de comprobación
	let objr = {};
	objr.api = {}
	objr.api.config = apiconfig;
	objr.api.cache = {};
	_.each(objr.api.config.model, (el) => {
		objr.api.cache[el.id] = {};	
	});
		
	// compruebo que cada elemento del modelo sea correcto (el formato asegurado por openApiValidator)
	for (let i=0; i<apiconfig.model.length; i++) {
		const mel = apiconfig.model[i];
		
		// comprobación de id no repetido
		for (let j=0; j<i; j++) {
			if (apiconfig.model[i].id === apiconfig.model[j].id)
				throw new Error('Duplicate id in model[' + j + '] and model[' + i + ']');
		}
		
		// combino todos los sublabels
		let sublabels = _.pluck(mel.oprops, 'label').concat(_.pluck(mel.dprops, 'label'), _.pluck(mel.types, 'label'));
		for (let j=0; j<sublabels.length; j++) {
			// comprobación de labels no repetidas		
			const evlab = sublabels[j];
			// obtengo primer índice del elemento j, si no es el mismo que j hay repetición
			const ind = sublabels.indexOf( evlab );
			if (ind != j)
				throw new Error('Duplicate label "' + sublabels[j] + '" in model[' + i + ']');
				
			// comprobación de label "iri"
			if (evlab === "iri")
				throw new Error('Wrong label name in model[' + i + ']. "iri" is forbidden for a label name');
		}
		
		// para cada oprop...
		for (let oi=0; oi<mel.oprops.length; oi++) {
			const oprop = mel.oprops[oi];

			// comprobación de endpoint existente
			const ep = _.find(apiconfig.endpoints, el => el.id === oprop.endpoint);
			if (ep == undefined)
				throw new Error('Wrong endpoint in model[' + i + '].oprops[' + oi + '].endpoint');
			
			// comprobación de targetId válido
			if (oprop.targetId != undefined) {
				const tmel = _.find(apiconfig.model, el => el.id === oprop.targetId);
				if (tmel == undefined)
					throw new Error('Wrong targetId in model[' + i + '].oprops[' + oi + ']');
			}
			
			// comprobación de targetId existente en caso de embed
			if (oprop.embed != undefined && oprop.embed && oprop.targetId == undefined)
				throw new Error('Missing targetId in model[' + i + '].oprops[' + oi + ']');
		}
		
		// para cada dprop...
		for (let di=0; di<mel.dprops.length; di++) {
			const dprop = mel.dprops[di];
				
			// comprobación de endpoint existente 
			const ep = _.find(apiconfig.endpoints, el => el.id === dprop.endpoint);
			if (ep == undefined)
				throw new Error('Wrong endpoint in model[' + i + '].dprops[' + di + '].endpoint');		
		}		
		
		// para cada type...
		for (let ti=0; ti<mel.types.length; ti++) {
			const type = mel.types[ti];
				
			// comprobación de endpoint existente 
			const ep = _.find(apiconfig.endpoints, el => el.id === type.endpoint);
			if (ep == undefined)
				throw new Error('Wrong endpoint in model[' + i + '].types[' + ti + '].endpoint');		
		}		
		
		// comprobación de ausencia de ciclos
		checkCycles(apiconfig, mel);

		// comprobación de restricciones con consulta de prueba
		objr.id = mel.id;
		objr.iris = [ testiri ];
		try {
			await dataManager.getData(objr, qinfo);
		} catch(err) {
			// fallo en la consulta, casi seguro por las restricciones
			throw new Error('Error testing the configuration of model[' + i + ']. Please check the syntax of the embedded restriction elements. This is the message returned from the endpoint: ' + err.message);
		}
	}
	
	
	// comprobaciones de las plantillas de consultas
	for (let i=0; i<apiconfig.queryTemplates.length; i++) {
		const qt = apiconfig.queryTemplates[i];
	
		// comprobación de id no repetido
		for (let j=0; j<i; j++) {
			if (apiconfig.queryTemplates[i].id === apiconfig.queryTemplates[j].id)
				throw new Error('Duplicate id in queryTemplates[' + j + '] and queryTemplates[' + i + ']');
		}
	
		// comprobación de endpoint existente
		const ep = _.find(apiconfig.endpoints, el => el.id === qt.endpoint);
		if (ep == undefined)
			throw new Error('Wrong endpoint in queryTemplates[' + i + '].endpoint');
		
		// preparo consultas de prueba con todos los parámetros y con sólo los obligatorios
		let qobjtodos = {};
		let qobjobli = {};
		for (let j=0; j<qt.parameters.length; j++) {
			const par = qt.parameters[j];
			switch(par.type) {			
				case "iri":
					qobjtodos[par.label] = testiri;
					if (par.optional == undefined || !par.optional)
						qobjobli[par.label] = testiri;
					break;
				case "string":
					qobjtodos[par.label] = "cadena";
					if (par.optional == undefined || !par.optional)
						qobjobli[par.label] = "cadena";
					break;
				case "integer":
				case "number":
					qobjtodos[par.label] = 1;
					if (par.optional == undefined || !par.optional)
						qobjobli[par.label] = 1;
					break;
				case "boolean":
					qobjtodos[par.label] = true;
					if (par.optional == undefined || !par.optional)
						qobjobli[par.label] = true;
					break;			
			}
		}
		
		// lanzo consulta qobjtodos
		let qresp;
		try {
			qresp = await dataManager.answerQuery(ep, qt, qobjtodos, qinfo);
		} catch(err) {
			// fallo en la consulta
			throw new Error('Error testing queryTemplates[' + i + ']. Please check the syntax of this template. This is the message returned from the endpoint: ' + err.message);
		}
		// compruebo que estén las variables definidas
		for (let j=0; j<qt.variables.length; j++) {
			const variable = qt.variables[j];
			if (!_.contains(qresp.head.vars, variable))
				throw new Error('Variable queryTemplates[' + i + '].variables[' 
					+ j + '] is not defined in the template');
		}
		
		// lanzo consulta qobjobli (para comprobar que funciona bien la opcionalidad)
		try {
			await dataManager.answerQuery(ep, qt, qobjobli, qinfo);
		} catch(err) {
			// fallo en la consulta
			throw new Error('Error testing queryTemplates[' + i + ']. Please check the syntax of this template. This is the message returned from the endpoint: ' + err.message);
		}
	}
	
	return; // no hay más que hacer
}

function checkCycles(apiconfig, mel) {
	// para evitar repeticiones
	const evaluados = [];
	const pendientes = [mel];
	
	while (pendientes.length > 0) {
		// quito primer elemento pendiente
		const evel = pendientes.shift();
		
		// sólo sigo si no lo evalué antes
		if (!_.contains(evaluados, evel)) {
			// obtengo targets de evel y los incluyo en pendientes
			for (let i=0; i<evel.oprops.length; i++) {
				const oprop = evel.oprops[i];
				if (oprop.embed != undefined && oprop.embed && oprop.targetId != undefined) {			
					const tmel = _.find(apiconfig.model, el => el.id === oprop.targetId);
					if (tmel != undefined) {
						// compruebo si hay ciclo (se saldría en el throw)
						if (tmel == mel) 
							throw new Error('Cycle in the model! Check oprops from element "' 
								+ mel.id + '" to "' + evel.id + '" and back to "' + mel.id + '"');
		
						// incluyo tmel en pendientes (si no lo estaba ya)
						if (!_.contains(pendientes, tmel))
							pendientes.push(tmel);
					}		
				}
			}
			// incluyo evel en evaluados
			evaluados.push(evel);
		}		
	}
}


// VALIDACIÓN DE RECURSO
function validateResource(iri, objr, mel, apiconfig, source) {
	// validación de la iri del recurso
	if (objr.iri == undefined)
		throw new Error("Resource data has NO iri at " + source);
	if (objr.iri !== iri)
		throw new Error("Resource data has a wrong iri at " + source);
	try {
		// lanza una excepción si iri no está bien formada: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
		new URL(iri); 
	} catch(error) {
		throw new Error('The "iri" is not well-formatted. ' + error.message);
	}
		
	// validación de las keys del recurso
	// combino todos los sublabels
	let sublabels = _.pluck(mel.oprops, 'label').concat(_.pluck(mel.dprops, 'label'), _.pluck(mel.types, 'label'));
	sublabels.push( "iri" ); // añado iri a la lista
	for (const key in objr) {
		if ( !_.contains(sublabels, key) )
			throw new Error('Key "' + key + '" in resource data (' + source + ') does not exist in the API model');
	}
	
	// validación de las dprops
	for (let i=0; i<mel.dprops.length; i++) {
		const dprop = mel.dprops[i];
		
		// si existe en objr...
		if (objr[dprop.label] != undefined) {
			// validación de endpoint con soporte a SPARQL update
			const ep = _.find(apiconfig.endpoints, el => el.id === dprop.endpoint);
			if (ep.sparqlUpdate == undefined)
				throw new Error('Updating resource data at ' + source + "." + dprop.label + ' requires SPARQL Update support at endpoint ' + ep.id);
		
			// el valor sólo puede ser un literal o un array de literales
			let valores = objr[dprop.label];
			if (!Array.isArray(valores)) { // convierto en array
				valores = [];
				valores.push(objr[dprop.label]);			
			}
			// comprobación de cada uno de los valores
			for (let j=0; j<valores.length; j++) {
				const valor = valores[j];
				if (Array.isArray(valor))
					throw new Error('Bad format of resource data at ' + source + "." + dprop.label + '[' + j + ']');
				if (typeof valor === 'object') {
					// el literal podría ser un objeto con una clave y de valor un literal
					if (Object.keys(valor).length == 1) {
						const mikey = Object.keys(valor)[0];
						if (typeof valor[mikey] !== 'object')
							break; // válido
					}			
					throw new Error('Bad format of resource data at ' + source + "." + dprop.label + '[' + j + ']');
				}
			}
		}	
	}
	
	// validación de los types
	for (let i=0; i<mel.types.length; i++) {
		const type = mel.types[i];
		
		// si existe en objr...
		if (objr[type.label] != undefined) {
			// validación de endpoint con soporte a SPARQL update
			const ep = _.find(apiconfig.endpoints, el => el.id === type.endpoint);
			if (ep.sparqlUpdate == undefined)
				throw new Error('Updating resource data at ' + source + "." + type.label + ' requires SPARQL Update support at endpoint ' + ep.id);
		
			// formateo como array si hace falta
			let valores = objr[type.label];
			if (!Array.isArray(valores)) { // convierto en array
				valores = [];
				valores.push(objr[type.label]);			
			}
			// comprobación de cada uno de los valores
			for (let j=0; j<valores.length; j++) {
				const valor = valores[j];
				if (Array.isArray(valor))
					throw new Error('Bad format of resource data at ' + source + "." + type.label + '[' + j + ']');
				// cada valor sólo puede ser una IRI o un objeto si está embebido
				if (typeof valor !== 'object') {
					try {
						new URL(valor);
					} catch(err) {
						throw new Error('Bad format of resource data at ' + source + "." + type.label + '[' + j + ']' + ': ' + err.message);
					}	
				}
				else { // es un objeto, compruebo que esté bien
					// 2021-mar permito embeber un recurso en un reemplazo
					// tiene que estar embebido en el modelo
					//if (type.embed == undefined || !type.embed)
					//	throw new Error('Bad format of resource data at ' + source + "." + type.label + '[' + j + ']. Cannot embed an object for this API model element');
					// hago comprobación del objeto embebido (llamada recursiva)
					const evel = _.find(apiconfig.model, el => el.id === type.targetId);
					if (evel == undefined)
						throw new Error('Bad format of resource data at ' + source + "." + type.label + '[' + j + ']. Cannot embed an object for this API model element');
					let newsource = source + "." + type.label + "[" + j + "]";					
					validateResource(valor.iri, valor, evel, apiconfig, newsource);
				}
			}
		}
	}
			
	// validación de los oprops
	for (let i=0; i<mel.oprops.length; i++) {
		const oprop = mel.oprops[i];
		
		// si existe en objr...
		if (objr[oprop.label] != undefined) {
			// validación de endpoint con soporte a SPARQL update
			const ep = _.find(apiconfig.endpoints, el => el.id === oprop.endpoint);
			if (ep.sparqlUpdate == undefined)
				throw new Error('Updating resource data at ' + source + "." + oprop.label + ' requires SPARQL Update support at endpoint ' + ep.id);
		
			// formateo como array si hace falta
			let valores = objr[oprop.label];
			if (!Array.isArray(valores)) { // convierto en array
				valores = [];
				valores.push(objr[oprop.label]);			
			}
			// comprobación de cada uno de los valores
			for (let j=0; j<valores.length; j++) {
				const valor = valores[j];
				if (Array.isArray(valor))
					throw new Error('Bad format of resource data at ' + source + "." + oprop.label + '[' + j + ']');
				// cada valor sólo puede ser una IRI o un objeto si está embebido
				if (typeof valor !== 'object') {
					try {
						new URL(valor);
					} catch(err) {
						throw new Error('Bad format of resource data at ' + source + "." + oprop.label + '[' + j + ']' + ': ' + err.message);
					}	
				}
				else { // es un objeto, compruebo que esté bien
					// 2021-mar permito embeber un recurso en un reemplazo
					// tiene que estar embebido en el modelo
					//if (oprop.embed == undefined || !oprop.embed)
					//	throw new Error('Bad format of resource data at ' + source + "." + oprop.label + '[' + j + ']. Cannot embed an object for this API model element');					
					// hago comprobación del objeto embebido (llamada recursiva)
					const evel = _.find(apiconfig.model, el => el.id === oprop.targetId);
					if (evel == undefined)
						throw new Error('Bad format of resource data at ' + source + "." + oprop.label + '[' + j + ']. Cannot embed an object for this API model element');
					let newsource = source + "." + oprop.label + "[" + j + "]";					
					validateResource(valor.iri, valor, evel, apiconfig, newsource);
				}
			}
		}
	}
}




// VALIDACIÓN DE PATCH
function validatePatch(patch, mel, apiconfig) {
	// itero por cada elemento del patch
	for (let i=0; i<patch.length; i++) {
		const pe = patch[i];
		
		// validación de existencia del value (peticiones add y replace)
		if (pe.value == undefined && pe.op !== "remove")
			throw new Error('Missing value in patch[' + i +']');
		else if (pe.value != undefined && pe.op === "remove")
			throw new Error('Bad format of patch[' + i +']. Remove operations do not have value');
		
				
		// validación del path: tendrá la forma "/key" o "/key/{ind}" donde "ind" será un entero o "-"
		let tokens = pe.path.split("/");
		// el path debe comenzar por "/"
		if (tokens.length == 1 || tokens[0] !== "")
			throw new Error('Wrong path in patch[' + i +']. Path must begin by "/"');
		// no permito paths con más de tres tokens (y el primer token será "")
		if (tokens.length > 3)
			throw new Error('Wrong path in patch[' + i +']. Only paths with 1 or 2 tokens are valid');
		
		// obtengo la key (a comprobar con mel) y el índice ind (si existe)
		// hay que hacer el escapado de "~" y "/"
		const key = tokens[1].replace(/~0/g, '~').replace(/~1/g, '/');
		const ind = tokens[2] == undefined? 
			undefined : tokens[2].replace(/~0/g, '~').replace(/~1/g, '/'); // cuidado, ind es una cadena
		
		// obtengo el subelemento al que aplica key
		let tsubel = -1; // 0: type  1: oprop  2: dprop
		let subel = _.find(mel.types, el => el.label === key);
		if (subel != undefined) // si es un type...
			tsubel = 0;		
		else {
			// compruebo si es un oprop...
			subel = _.find(mel.oprops, el => el.label === key);
			if (subel != undefined)
				tsubel = 1;
			else {
				// compruebo si es un dprop...
				subel = _.find(mel.dprops, el => el.label === key);
				if (subel != undefined)
					tsubel = 2;
			}
		}
		// si no existe en el modelo...
		if (tsubel == -1)
			throw new Error('Wrong path in patch[' + i +']. The element with id ' + mel.id 
				+ ' in the API does not have a member with key "' + key + '"');
		
		// validamos que soporte sparql update
		const ep = _.find(apiconfig.endpoints, el => el.id === subel.endpoint);
		if (ep.sparqlUpdate == undefined)
			throw new Error('Resource not updatable. Updating resource data at ' + mel.id + "." + key + ' requires SPARQL Update support at endpoint ' + ep.id);
		
		// validamos que el índice esté bien
		if (ind != undefined) {
			if (ind === '-') {// sólo válido en peticiones add
				if (pe.op !== "add") 
					throw new Error('Wrong path in patch[' + i +']. "-" is only valid in add operations');
			} else {
				// ind debe ser un entero no negativo
				const pind =  Number.parseInt(ind, 10); // conversión muy optimista...				
				if ( !Number.isInteger(pind) )
					throw new Error('Wrong path in patch[' + i +']. "' + ind + '" has to be an integer');
				if ( pind < 0 )
					throw new Error('Wrong path in patch[' + i +']. "' + ind + '" cannot be a negative integer');		
			}
		}		
		
		// validación del value
		if (pe.value != undefined) {
			// formateo como array si hace falta
			let valores = pe.value;
			if (!Array.isArray(valores)) { // convierto en array
				valores = [];
				valores.push(pe.value);			
			}
			// si hay índice no puede haber varios valores
			if (ind != undefined && valores.length > 1)
				throw new Error('Bad format of value at patch[' + i +']. It cannot be an array');
			// analizo cada valor según el tipo de subelemento
			for (let j=0; j<valores.length; j++) {
				const valor = valores[j];
				// valor no puede ser un array a su vez
				if (Array.isArray(valor))
					throw new Error('Bad format of value[' + j + '] at patch[' + i +']');
				// validación por tipo de subelemento
				if (tsubel == 2) { // dprop
					if (typeof valor === 'object') {
						// el literal podría ser un objeto con una clave y de valor un literal
						if (Object.keys(valor).length == 1) {
							const mikey = Object.keys(valor)[0];
							if (typeof valor[mikey] !== 'object')
								break; // válido
						}			
						throw new Error('Bad format of value[' + j + '] at patch[' + i +']');
					}				
				} else { // type o oprop
					// cada valor sólo puede ser una IRI o un objeto si está embebido
					if (typeof valor !== 'object') {
						try {
							new URL(valor);
						} catch(err) {
							throw new Error('Bad format of value[' + j + '] at patch[' + i +']: ' + err.message);
						}	
					}
					else { // es un objeto, compruebo que esté bien
						// 2021-mar permito embeber un recurso en una actualización
						// tiene que estar embebido en el modelo
						//if (subel.embed == undefined || !subel.embed)
						//	throw new Error('Bad format of value[' + j + '] at patch[' + i +']. Cannot embed an object for this API model element');
						// hago comprobación del objeto embebido utilizando validateResource
						const evmel = _.find(apiconfig.model, el => el.id === subel.targetId);
						if (evmel == undefined)
							throw new Error('Bad format of value[' + j + '] at patch[' + i +']. Cannot embed an object for this API model element');
						let newsource = "value[" + j + "]";
						try {
							validateResource(valor.iri, valor, evmel, apiconfig, newsource);
						} catch(err) {
							throw new Error('Bad format of value[' + j + '] at patch[' + i +']: ' + err.message);
						}						
					}
				}			
			}		
		}
	}
}




// VALIDACIÓN DE LAS CONSULTAS PARAMETRIZADAS
function validateQuery(qtemp, objpars) {
	// analizo cada parámetro de la plantilla
	for (let i=0; i<qtemp.parameters.length; i++) {				
		const par = qtemp.parameters[i];
		// si existe el parámetro en la petición...
		if (objpars[par.label] != undefined) {
			// compruebo si el parámetro es del tipo adecuado (y convierto a número si hace falta)
			try {
				switch(par.type) {
					case "iri":
						// lanza una excepción si la URL no es válida: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
						new URL(objpars[par.label]); 
						break;
					case "string":
						if (typeof objpars[par.label] !== "string")
							throw new Error("Invalid type");
						break;
					case "integer":
						// convertimos a un entero (base 10) y comprobamos que la conversión fue bien
						objpars[par.label] = Number.parseInt(objpars[par.label], 10);
						//console.log( "Valor: " + valor + " - es entero: " + Number.isInteger(valor));
						if ( !Number.isInteger(objpars[par.label]) )
							throw new Error("Invalid type");
						break;
					case "number":
						// convertimos a número y comprobamos que la conversión fue bien
						objpars[par.label] = Number(objpars[par.label]);
						//console.log( "Valor: " + valor + " - no es un número: " + isNaN(valor));
						if ( isNaN(objpars[par.label]) )	
							throw new Error("Invalid type");
						break;
					case "boolean":
						// parseo de la cadena
						objpars[par.label] = JSON.parse(objpars[par.label].toLowerCase());
						//console.log( "Valor: " + req.query[par.label] + " - parseado: " + valor);
						// comprobación de booleano
						if ( objpars[par.label] !== true && objpars[par.label] !== false)
							throw new Error("Invalid type");
						break;
					default:
						throw new Error("Unknown type");
						break;
				}					
			} catch(error) {
				// tipo de parámetro incorrecto
				throw new Error('The value of parameter "' + par.label + 
					'" is not of type "' + par.type + '"');
			}
		}
		else if (par.optional == undefined || !par.optional) {
			// petición incorrecta, parámetro requerido
			throw new Error('The query template "' + qtemp.id + 
				'" requires query parameter "' + par.label + '"');
		}			
	}
}


// VALIDACIÓN DE LAS CONFIGURACIONES DE DUMPS
function validateDumpConfig(dc, apiconfig) {
	// estructura de parameters asegurada por openApiValidator	

	// validamos los steps
	for (let i=0; i<dc.steps.length; i++) {
		const step = dc.steps[i];
		
		// comprobación de id no repetido
		for (let j=0; j<i; j++) {
			if (dc.steps[i].id === dc.steps[j].id)
				throw new Error('Duplicate id in steps[' + j + '] and steps[' + i + ']');
		}
		
		let valid;		
		switch(step.type) {
			case "resource":
				// tiene que haber un parámetro "id"
				valid = extactStepParameter("id", step, i, dc);
				// validamos con el modelo
				if (valid.type == undefined) {
					const mel = _.find(apiconfig.model, el => el.id === valid);
					if (mel == undefined)
						throw new Error('Wrong model id in steps[' + i + '].parameters.id. Check your API model');
					// existe mel, todo bien
				} else // viene de un step previo, comprobamos estructura con apiconfig
					checkStepresultWithApiconfig(valid, apiconfig);
				
				// tiene que haber un parámetro "iri"
				const valiri = extactStepParameter("iri", step, i, dc);
				// validamos la IRI
				if (valiri.type == undefined) {
					try { 
						new URL(valiri);
					} catch(err) {
						throw new Error('Wrong IRI format in steps[' + i + '].parameters.iri. ' + err.message);
					}				
					// IRI válida
				} else // viene de un step previo, comprobamos estructura con apiconfig
					checkStepresultWithApiconfig(valiri, apiconfig);				
				break;
			case "resources":
				// tiene que haber un parámetro "id"
				valid = extactStepParameter("id", step, i, dc);
				// validamos con el modelo
				if (valid.type == undefined) {
					const mel = _.find(apiconfig.model, el => el.id === valid);
					if (mel == undefined)
						throw new Error('Wrong model id in steps[' + i + '].parameters.id. Check your API model');
					// existe mel, todo bien
				} else // viene de un step previo, comprobamos estructura con apiconfig
					checkStepresultWithApiconfig(valid, apiconfig);
				
				// tiene que haber un parámetro "iris"
				let valiris = extactStepParameter("iris", step, i, dc);
				if (valiris.type != undefined) // viene de un step previo, comprobamos estructura con apiconfig
					checkStepresultWithApiconfig(valiris, apiconfig);
				else {
					// antes de validar las iris miramos parámetros opcionales ns y nspref
					let comprobariris = true;
					try {
						// extraigo parámetros opcionales
						const ns = extactStepParameter("ns", step, i, dc);
						const nspref = extactStepParameter("nspref", step, i, dc);
						if (ns.type != undefined || nspres.type != undefined) {
							// caso muy raro, los valores de ns y/o nspref vienen de un step anterior
							comprobariris = false; // no podemos validar las iris
						}
						else { // hacemos las sustituciones que hagan falta
							let newvaliris = _.clone(valiris);	// clonamos por precaución						
							const nsprefplus = nspref + ':';
							for (let j=0; j<newvaliris.length; j++) {
								if (newvaliris[j].startsWith( nsprefplus ))
									newvaliris[j] = newvaliris[j].replace( nsprefplus, ns );
							}
							valiris = newvaliris;
						}						
					} catch(err) {
						// no hacemos nada aquí al ser parámetros opcionales
					}
					if (comprobariris) {
						try {
							for (let j=0; j<valiris.length; j++) 
								new URL(valiris[j]);
						} catch(err) {
							throw new Error('Wrong IRI format in steps[' + i + '].parameters.iris. ' + err.message);
						}
					}
				}			
				break;
			case "query":
				// tiene que haber un parámetro "id"
				valid = extactStepParameter("id", step, i, dc);
				// validamos con la query template
				if (valid.type == undefined) {
					const qt = _.find(apiconfig.queryTemplates, el => el.id === valid);
					if (qt == undefined)
						throw new Error('Wrong query template id in steps[' + i + '].parameters.id. Check your API query templates');
					// existe qt, comprobamos ahora los parámetros
					for (let j=0; j<qt.parameters.length; j++) {
						const par = qt.parameters[j];						
						// si existe el parámetro en el step...						
						if (step.parameters[par.label] != undefined) {
							// extraigo valor
							let parval = extactStepParameter(par.label, step, i, dc);
							if (parval.type != undefined) // viene de un step previo, comprobamos estructura con apiconfig
								checkStepresultWithApiconfig(parval, apiconfig);
							else {							
								// compruebo si el parámetro es del tipo adecuado
								try {
									switch(par.type) {
										case "iri":
											new URL(parval);
											break;
										case "string":
											if (typeof parval !== "string")
												throw new Error("Invalid type");
											break;
										case "integer":
											// convertimos a un entero (base 10) y comprobamos que la conversión fue bien
											parval = Number.parseInt(parval, 10);
											if ( !Number.isInteger(parval) )
												throw new Error("Invalid type");
											break;
										case "number":
											// convertimos a número y comprobamos que la conversión fue bien
											parval = Number(parval);
											if ( isNaN(parval) )
												throw new Error("Invalid type");
											break;
										case "boolean":
											// parseo de la cadena
											parval = JSON.parse(parval.toLowerCase());
											// comprobación de booleano
											if ( parval !== true && parval !== false)
												throw new Error("Invalid type");
											break;
									}					
								} catch(error) {
									// tipo de parámetro incorrecto
									throw new Error('Query template parameter ' + par.label + ' in steps['
										 + i + '].parameters is not of type ' + par.type);
								}								
							}
						} else if (par.optional == undefined || !par.optional) {
							// configuración incorrecta, parámetro requerido
							throw new Error('Missing query template parameter ' + par.label + ' in steps['
								 + i + '].parameters. Check your API query templates');
						}					
					} // <- for qt.parameters
				} else // viene de un step previo, comprobamos estructura con apiconfig
					checkStepresultWithApiconfig(valid, apiconfig);				
				break;
		} // <- switch step.type
	} // <- for steps
	
	// validamos los outputs
	for (let i=0; i<dc.output.length; i++) {
		const output = dc.output[i];
				
		// valido el output
		if (output.source === 'parameters') { // si se trata de un parameter...
			if (output.key == undefined)
				throw new Error('Missing output[' + i + '].key');		
			if (dc.parameters == undefined || dc.parameters[output.key] == undefined)
				throw new Error('Missing parameters.' + output.key);
		} 
		else if (output.source === 'steps') { // si es un step previo...
			if (output.id == undefined)
				throw new Error('Missing output[' + i + '].id');
			// recupero el step correspondiente
			const step = _.find(dc.steps, el => el.id === output.id);
			if (step == undefined)
				throw new Error('Wrong previous step referenced in output[' + i + '].id');
		} 
	}
	
	return; // no hay más que hacer
}

function extactStepParameter(plab, step, i, dc) {
	if (step.parameters[plab] == undefined) // si no definido...
		throw new Error('Missing steps[' + i + '].parameters.' + plab);
	if (step.parameters[plab].source != undefined && step.parameters[plab].source === 'steps') {
		// obtengo step al que hace referencia
		let prevstep = null;
		let j=0; // inicializo...
		for (; j<i; j++) {
			const evstep = dc.steps[j]
			if (evstep.id === step.parameters[plab].id) {
				prevstep = evstep;
				break;
			}		
		}
		if (prevstep == null)
			throw new Error('Wrong previous step referenced in steps[' + i + '].parameters.' + plab + '.id');
		// hay prevstep, preparo objeto de respuesta
		let resp = {};
		resp.type = prevstep.type;
		resp.stepNum = i;
		resp.stepRefNum = j;
		if (prevstep.type === 'query') { // en las peticiones de tipo query...
			// tiene que haber "variable" en step para extraer el valor
			if (step.parameters[plab].variable == undefined)
				throw new Error('Missing steps[' + i + '].parameters.' + plab + '.variable');
			resp.variable = step.parameters[plab].variable;					
		}
		else { // en las peticiones de tipo resource/resources...
			// tiene que haber "key" en step para extraer el valor
			if (step.parameters[plab].key == undefined)
				throw new Error('Missing steps[' + i + '].parameters.' + plab + '.key');
			resp.key = step.parameters[plab].key;
		}	
		// extraigo el id de la template query o la petición resource/resources
		resp.id = extactStepParameter("id", prevstep, j, dc);
		// devuelvo el objeto con la info para validar con el modelo
		return resp;	
	}
	else if (step.parameters[plab].source != undefined && step.parameters[plab].source === 'parameters') {
		// comprobación redundante, hecha en openApiValidator...
		if (step.parameters[plab].key == undefined)
			throw new Error('Missing steps[' + i + '].parameters.' + plab + '.key');
		// extraigo valor de los parámetros
		if (dc.parameters == undefined || dc.parameters[step.parameters[plab].key] == undefined)
			throw new Error('Missing parameters.' + step.parameters[plab].key);
		return dc.parameters[step.parameters[plab].key];
	}
	else
		return step.parameters[plab];
}

function checkStepresultWithApiconfig(stepr, apiconfig) {
	if (stepr.type === 'query') {
		// tiene que existir la query template correspondiente en el modelo
		const qt = _.find(apiconfig.queryTemplates, el => el.id === stepr.id);
		if (qt == undefined)
			throw new Error('Wrong query template id in steps[' + 
				stepr.stepRefNum + '].parameters.id. Check your API query templates');
		// compruebo que exista una variable que coincida
		if (!_.contains(qt.variables, stepr.variable))
			throw new Error('Wrong query template variable in steps[' + 
				stepr.stepNum + '].parameters.variable. Check your API query templates');
	} else { // petición tipo resource / resources
		// tiene que existir el mel correspondiente en el modelo
		const mel = _.find(apiconfig.model, el => el.id === stepr.id);
		if (mel == undefined)
			throw new Error('Wrong model id in steps[' + 
				stepr.stepRefNum + '].parameters.id. Check your API model');
		// compruebo que exista una label que coincida con la key proporcionada en stepr
		for (let i=0; i<mel.oprops.length; i++) {
			if (mel.oprops[i].label === stepr.key)
				return;
		}
		for (let i=0; i<mel.dprops.length; i++) {
			if (mel.dprops[i].label === stepr.key)
				return;
		}
		for (let i=0; i<mel.types.length; i++) {
			if (mel.types[i].label === stepr.key)
				return;
		}
		// si llega hasta aquí es que no se encontró...	
		throw new Error('Wrong key in steps[' + 
			stepr.stepNum + '].parameters.key. Check your API model');
	}
}


module.exports = {
	validateAPIConfig,
	validateResource,
	validatePatch,
	validateQuery,
	validateDumpConfig
}