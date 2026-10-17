const dataManager = require('./dataManager');
const mustache = require('mustache');

const testiri = 'http://prueba.es';
const testiri2 = 'http://prueba2.es';

// nov-25: meto wtks como cadenas de prueba
// may-26: revierto a otras cadenas de prueba
// oct-26: pongo opción "notest" para un elemento del modelo por si se quiere no probar
const testcad = "string"; //"POINT(0 0)";
const testcad2 = "string2"; //"POINT(20 20)";

// VALIDACIÓN DE LAS CONFIGURACIONES DE APIS
async function validateApi(api, qinfo) {
	// me centro en apiconfig, pero me aprovecho del resto de la api
	const apiconfig = api.config;
	// me aseguro de que haya al menos un endpoint definido (el formato asegurado por openApiValidator)
	if (apiconfig.endpoints.length == 0)
		throw new Error("The configuration has NO endpoint");
		
	// compruebo que funcionen los endpoints definidos
	try {
		let promesas = [];
		const epus = [];		
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
			if (apiconfig.endpoints[i].sparqlUpdate != null) {
				// cojo endpoint de sparql update normalizado
				const epu = api.endpointsById[`${apiconfig.endpoints[i].id}_update`];
				
				/* previo
				// cojo referencias
				const ep = apiconfig.endpoints[i];
				let epu = apiconfig.endpoints[i].sparqlUpdate;
				// incluyo id con coletilla _update
				epu.id = ep.id + "_update";
				// replico info del endpoint contenedor si no estuviera incluida
				if (epu.sparqlURI == null && ep.sparqlURI != null)
					epu.sparqlURI = ep.sparqlURI;
				if (epu.graphURI == null && ep.graphURI != null)
					epu.graphURI = ep.graphURI;
				if (epu.httpMethod == null && ep.httpMethod != null)
					epu.httpMethod = ep.httpMethod;
				if (epu.authInfo == null && ep.authInfo != null)
					epu.authInfo = ep.authInfo;*/
				
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
		for (const epu of epus)	// preparo promesa "testDelete"
			promesas.push( dataManager.testEndpoint(epu, "testDelete", qinfo) );
		// espero a que terminen todas las promesas
		await Promise.all(promesas);
	} catch(err) {
		//console.error(err.stack);
		throw new Error('Some endpoint is not working: ' + err.message);
	}	
	
	// preparo un objeto para consultas de comprobación
	const objr = { api }; // me quedo con la api
	/*
	const objr = {};
	objr.api = {};
	objr.api.config = apiconfig;
	objr.api.cache = {};
	for (const el of objr.api.config.model)
		objr.api.cache[el.id] = {};*/
		
	// compruebo que cada elemento del modelo sea correcto (el formato asegurado por openApiValidator)
	for (const [i, mel] of apiconfig.model.entries()) {
		// comprobación de id no repetido
		for (let j=0; j<i; j++) {
			if (mel.id === apiconfig.model[j].id)
				throw new Error(`Duplicate id "${mel.id}" in model[${j}] and model[${i}]`);
		}
				
		// 2021-11-05 incluyo soporte a herencias
		// compruebo las herencias de mel
		if (mel.extends != null) {
			// array con todos los elementos heredados
			const melextids = [];
			let melaux = mel; // inicializo con el mel inicial
			do {
				// compruebo si hay ciclo (funcionará incluso si hay un extends sobre sí mismo)
				if (melextids.includes(melaux.id)) // ciclo, aviso en el throw
					throw new Error('Cycle in the model! Check extends from element "${mel.id}"');
				// no hay ciclo, incluimos en el array
				melextids.push( melaux.id );
				// si hay extends comprobamos existencia
				if (melaux.extends != null) {
					const melauxext = apiconfig.model.find(el => el.id === melaux.extends);
					if (melauxext == null)
						throw new Error(`Wrong extends value in element "${melaux.id}" of the model`);
					// existe, actualizamos melaux
					melaux = melauxext;	
				}			
			} while (melaux.extends != null);
		}
				
		// obtengo melext a partir de las herencias
		const melext = dataManager.getExtendedMel(api, mel);
		
		// combino todos los sublabels (2021-11-05 lo hago con melext)
		// comprobación de labels no repetidas
		// comprobación de no existencia de label "iri"
		const sublabels = [
			...melext.props.map(el => el.label),
			...melext.types.map(el => el.label),
			...melext.joins.map(el => el.label)
		];
		const seen = new Set();
		for (const evlab of sublabels) {
			if (seen.has(evlab))
				throw new Error(`Duplicate label "${evlab}" in model[${i}] (${mel.id})`);
			if (evlab === "iri")
				throw new Error(`Wrong label name in model[${i}] (${mel.id}). "iri" is forbidden for a label name`);
			seen.add(evlab);
		}
		
		// comprobación de endpoint existente
		// para datatype me aseguro de que no hay targetId ni embed
		// comprobación de targetId válido
		// comprobación de bindings alternativos
		for (const [collectionName, collection] of [
			["props", mel.props ?? []],
			["types", mel.types ?? []],
			["joins", mel.joins ?? []]
		]) {
			for (const [idx, item] of collection.entries()) {
				// comprobación de endpoint existente
				//if (!apiconfig.endpoints.some(el => el.id === item.endpoint)) {
				if (!api.endpointsById[item.endpoint]) {
					throw new Error(
						`Wrong "endpoint" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})`
					);
				}
				
				// comprobaciones datatype
				if (item.proptype != null && item.proptype === "datatype") {
					if (item.targetId != null) {
						throw new Error(
							`Forbidden "targetId" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})`+
							` => "targetId" is not allowed for datatype properties`
						);
					}
					if (item.embed != null) {
						throw new Error(
							`Forbidden "embed" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
							` => "embed" is not allowed for datatype properties`
						);
					}
				}				

				// comprobación de targetId válido
				if (item.targetId != null && !api.modelById[item.targetId]) {
						//!apiconfig.model.some(el => el.id === item.targetId)) {
					throw new Error(
						`Wrong "targetId" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
						` => "${item.targetId}" does not exist in the model`
					);
				}

				// comprobación de targetId existente en caso de embed
				if (item.embed && item.targetId == null) {
					throw new Error(
						`Use of "embed" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label}), but missing "targetId"`
					);
				}

				// comprobación de bindings alternativos
				if (item.altResult != null && item.altVariable == null) {
					throw new Error(
						`Use of "altResult" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label}), but missing "altVariable"`
						//`Missing "altVariable" in model[${i}].${collectionName}[${idx}]`
					);
				}
				if (item.altResult == null && item.altVariable != null) {
					throw new Error(
						`Use of "altVariable" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label}), but missing "altResult"`
						//`Missing altResult in model[${i}].${collectionName}[${idx}]`
					);
				}
				if (item.altResult != null &&
					item.altVariable != null &&
					!item.altResult.includes(`?${item.altVariable}`)
				) {
					throw new Error(
						`Wrong construction of "altResult" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
						` => "altVariable" has to be returned`
					);
				}
				
				// comprobaciones adicionales joins
				// source sólo puede ser "iri" o un subelemento en types o props (nunca en joins)
				if (item.source != null && item.source != "iri") {
					if ( ![ ...melext.types, ...melext.props ].find(subel => subel.label === item.source)) {
					throw new Error(
						`Wrong "source" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
							` => subelement "${item.source}" does not exist in "${mel.id}"`
						);
					}
				}
				// validez inputRegex
				if (item.inputRegex != null) {
					try {
						new RegExp(item.inputRegex);
					}
					catch (err) {
						throw new Error(`Wrong "inputRegex" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
							` => use a valid regular expression"`
							);
					}
				}
				// validez inputRegexGroup
				if (item.inputRegexGroup != null && item.inputRegexGroup < 1) {
					throw new Error(`Wrong "inputRegexGroup" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
						` => it must be a positive integer (> 0)"`);
					
				}
				// validez inputTransform
				if (item.inputTransform != null) {
					try {
						mustache.render(item.inputTransform, { input: testcad });
					}
					catch (err) {
						throw new Error(`Wrong "inputTransform" in model[${i}].${collectionName}[${idx}] (${mel.id}.${item.label})` +
							` => use a valid Mustache template"`
							);
					}
				}
				// NOTA: sólo se probarán los joins con source "iri" por falta de datos en source
			}
		}
		
		// comprobación de ausencia de ciclos
		checkCycles(api, mel);
		
		// oct-26: nuevo, por si no quiero comprobar algún elemento del modelo
		if (mel.notest === true)
			continue;
		
		// comprobación de restricciones con consulta de prueba
		objr.id = mel.id;
		objr.iris = [ testiri ];
		try {
			await dataManager.getData(objr, qinfo);
		} catch(err) {
			//console.log(`Model ID: ${mel.id}`);
			//console.error(err.stack);
			
			// fallo en la consulta, casi seguro por las restricciones
			throw new Error(`Error testing the configuration of model[${i}] (${mel.id}). Please check your model, particularly the syntax of included restrictions. This is the message returned from the endpoint: ${err.message}`);
		}
	}	
	
	// comprobaciones de las plantillas de consultas
	for (const [i, qt] of apiconfig.queryTemplates.entries()) {	
		// comprobación de id no repetido
		for (let j=0; j<i; j++) {
			if (qt.id === apiconfig.queryTemplates[j].id)
				throw new Error(`Duplicate id "${qt.id}" in queryTemplates[${j}] and queryTemplates[${i}]`);
		}
	
		// comprobación de endpoint existente
		const ep = api.endpointsById[qt.endpoint];
		if (ep == null)
			throw new Error(`Wrong endpoint in queryTemplates[${i}].endpoint`);
		
		// sept-26: nuevo, por si no quiero comprobar alguna plantilla
		if (qt.notest === true)
			continue;
	
		// preparo consultas de prueba con todos los parámetros y con sólo los obligatorios
		const qobjtodos = {};
		const qobjobli = {};
		for (const par of qt.parameters) {
			// 2021-10-27 incluyo soporte a arrays
			if (par.type.endsWith('[]')) {
				// es un array, extraigo tipo (quitando "[]")
				const tipo = par.type.substring(0, par.type.length -2);
				// preparo arrays con la consulta de prueba				
				switch(tipo) {			
					case "iri":
						qobjtodos[par.label] = [testiri, testiri2];
						if (par.optional == null || !par.optional) 
							qobjobli[par.label] = [testiri, testiri2];
						break;
					case "string":
						qobjtodos[par.label] = [testcad, testcad2];
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = [testcad, testcad2];
						break;
					case "integer":
					case "number":
						qobjtodos[par.label] = [1, 2];
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = [1, 2];
						break;
					case "boolean":
						qobjtodos[par.label] = [true, false];
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = [true, false];
						break;			
				}			
			} else {
				// sigo con la consulta de prueba que tenía de antes
				switch(par.type) {			
					case "iri":
						qobjtodos[par.label] = testiri;
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = testiri;
						break;
					case "string":
						qobjtodos[par.label] = testcad;
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = testcad;
						break;
					case "integer":
					case "number":
						qobjtodos[par.label] = 1;
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = 1;
						break;
					case "boolean":
						qobjtodos[par.label] = true;
						if (par.optional == null || !par.optional)
							qobjobli[par.label] = true;
						break;			
				}			
			}			
		}
		
		// lanzo consulta qobjtodos
		let qresp;
		try {
			qresp = await dataManager.answerQuery(api, qt, qobjtodos, qinfo);
		} catch(err) {
			// fallo en la consulta
			throw new Error(`Error testing queryTemplates[${i}] (${qt.id}). Please check the syntax of this template. This is the message returned from the endpoint: ${err.message}`);
		}
		// compruebo que estén las variables definidas
		for (const [j, variable] of qt.variables.entries()) {
		    if (!qresp.data.head.vars.includes(variable)) {
        		throw new Error(
    		        `Variable queryTemplates[${i}].variables[${j}] is not defined in the template (${qt.id})`
	        	);
		    }
		}
		
		// lanzo consulta qobjobli (para comprobar que funciona bien la opcionalidad)
		try {
			await dataManager.answerQuery(api, qt, qobjobli, qinfo);
		} catch(err) {
			// fallo en la consulta
			throw new Error(`Error testing queryTemplates[${i}] (${qt.id}). Please check the syntax of this template. This is the message returned from the endpoint: ${err.message}`);
		}
	}
	
	return; // no hay más que hacer
}

function checkCycles(api, mel) {
	// 2011-11-05 rehecho para que funcione con herencias
    const evaluados = new Set();
    const pendientes = [mel];
    while (pendientes.length > 0) {
        // quito primer elemento pendiente
        const evel = pendientes.shift();
        const evelext = dataManager.getExtendedMel(api, evel);

        // sólo sigo si no lo evalué antes
        if (!evaluados.has(evel)) {
            // obtengo targets de evelext y los incluyo en pendientes
            for (const prop of evelext.props) {
                if (prop.embed && prop.targetId != null) {
                    const tmel = api.modelById[prop.targetId];
                    if (tmel) {
                        // compruebo si hay ciclo
                        if (tmel === mel) {
                            throw new Error(
                                `Cycle in the model! Check props from element "${mel.id}" to "${evel.id}" and back to "${mel.id}"`
                            );
                        }
                        // incluyo tmel en pendientes (si no lo estaba ya)
                        if (!pendientes.includes(tmel))
                            pendientes.push(tmel);
                    }
                }
            }
            // incluyo evel en evaluados
            evaluados.add(evel);
        }
    }
}


// VALIDACIÓN DE RECURSO
function validateResource(iri, objr, mel, api, source) {
    // validación de la iri del recurso
    if (objr.iri == null)
        throw new Error(`Resource data has NO iri at ${source}`);
    if (objr.iri !== iri) 
        throw new Error(`Resource data has a wrong iri at ${source}`);
    try {
        new URL(iri);
    } catch (error) {
        throw new Error(`The "iri" is not well-formatted. ${error.message}`);
    }

    // 2021-11-05 trabajo aquí con melext para manejar bien las herencias
    const melext = dataManager.getExtendedMel(api, mel);

    // validación de las keys del recurso
    const sublabels = [
        ...melext.props.map(el => el.label),
        ...melext.types.map(el => el.label),
        "iri"
    ];
    for (const key of Object.keys(objr)) {
        if (!sublabels.includes(key)) {
            throw new Error(
                `Key "${key}" in resource data (${source}) does not exist in the API model`
            );
        }
    }

    // la clave ahora es mirar si hay targetId (resultando en una IRI sin embed o un objeto con embed)
    // y cuidado con los datatypes, que podrían ser objetos en algunos casos

    // validación de types y props
    for (const collection of [melext.types, melext.props]) {
        for (const item of collection) {
            if (objr[item.label] == null)
                continue;

			// existe en objr...
			
			// comprobación de ítem no actualizable. No permito:
			// 1) property path (que no sea un simple ^)	
			// 2) no vale property path inversa ^ con datatype
			// 3) tampoco vale altResult
			// pero permito restricciones (que no se van a procesar al actualizar)
			// 1) property path: sólo valen <iri> y ^iri
			if (item.propexpr && !item.propexpr.match(/^(\^)?<([^>]+)>$/)) {
                throw new Error(
                    `Resource data at ${source}.${item.label} cannot be written due to property paths in "propexpr"`
                );
            }
			// 2) no vale property path inversa ^ con datatype
			if (item.proptype === "datatype" && item.propexpr?.startsWith("^")) {
				throw new Error(
                    `Resource data at ${source}.${item.label} cannot be written due to the inverse property path in "propexpr"`
                );
			}
			
			// 3) tampoco vale altResult
			if (item.altResult) {
                throw new Error(
                    `Resource data at ${source}.${item.label} cannot be written due to "altResult"`
                );
            }
			
			// validación de endpoint con soporte a SPARQL update
            const ep = api.endpointsById[item.endpoint];
            if (ep.sparqlUpdate == null) {
                throw new Error(
                    `Updating resource data at ${source}.${item.label} requires SPARQL Update support at endpoint ${ep.id}`
                );
            }
            
            // formateo como array si hace falta
            const valores = Array.isArray(objr[item.label])
                ? objr[item.label]
                : [objr[item.label]];
			// comprobación de cada uno de los valores
            for (const [j, valor] of valores.entries()) {
            	// valor nunca puede ser un array
                if (Array.isArray(valor)) {
                    throw new Error(
                        `Bad format of resource data at ${source}.${item.label}[${j}]`
                    );
                }                
                
                // si no hay targetId, el valor puede ser una IRI o un literal, pero NO un objeto embebido
                if (item.targetId == null) {
                	// para types y object properties sólo puede ser una IRI
                	// (ya que no hay objetos embebidos ni altResult)
                	if (item.proptype == null || item.proptype === "object") {
						try {
							new URL(valor);
						} catch (err) {
							throw new Error(
								`Bad format of resource data at ${source}.${item.label}[${j}]: ${err.message}`
							);
						}
						continue;
                	}
                	
                	// caso literal
                	if (typeof valor === "object" && valor != null) {
						// el literal podría ser un objeto con una clave y de valor un literal
						if (Object.keys(valor).length === 1) {
							const key = Object.keys(valor)[0];
							if (typeof valor[key] !== "object")
								continue;
						}
						throw new Error(
							`Bad format of resource data at ${source}.${item.label}[${j}]`
						);
					}
					continue;
                }
                
                
                // hay targetId                
                
                // el valor sólo puede ser una IRI o un objeto embebido
                if (typeof valor !== "object" || valor === null) {
                    try {
                        new URL(valor);
                    } catch (err) {
                        throw new Error(
                            `Bad format of resource data at ${source}.${item.label}[${j}]: ${err.message}`
                        );
                    }
                    continue;
                }
                // es un objeto, compruebo que esté bien
				// 2021-mar permito embeber un recurso en un reemplazo
				// tiene que estar embebido en el modelo
				// hago comprobación del objeto embebido (llamada recursiva)
                const evel = api.modelById[item.targetId];
                if (!evel) {
                    throw new Error(
                        `Bad format of resource data at ${source}.${item.label}[${j}]. Cannot embed an object for this API model element`
                    );
                }
                validateResource(
                    valor.iri,
                    valor,
                    evel,
                    api,
                    `${source}.${item.label}[${j}]`
                );
            }
        }
    }
}



// VALIDACIÓN DE PATCH
function validatePatch(patch, mel, api) {
    // 2021-11-05 trabajo aquí con melext para manejar bien las herencias
	const melext = dataManager.getExtendedMel(api, mel);

	// patch siempre es un array (asegurado por el valor de OpenAPI)
	// itero por cada elemento del patch
	for (let i=0; i<patch.length; i++) {
		const pe = patch[i];
		
		// validación de la operación del patch (ya comprobado por el validador OpenAPI)
		//if (!["add", "replace", "remove"].includes(pe.op))
		//	throw new Error('Unknown operation "' + pe.op + '" in patch[' + i + ']');
		
		// validación de existencia del value (peticiones add y replace)
		if (pe.value == null && pe.op !== "remove")
			throw new Error('Missing value in patch[' + i +']');
		if (pe.value != null && pe.op === "remove")
			throw new Error('Bad format of patch[' + i +']. Remove operations do not have value');
		
		// validación del path: tendrá la forma "/key" o "/key/{ind}" donde "ind" será un entero o "-"
		if (typeof pe.path !== "string")
			throw new Error('Missing path in patch[' + i + ']');
		let tokens = pe.path.split("/");
		// el path debe comenzar por "/"
		if (tokens.length === 1 || tokens[0] !== "")
			throw new Error('Wrong path in patch[' + i +']. Path must begin by "/"');
		// no permito paths con más de tres tokens (y el primer token será "")
		if (tokens.length > 3)
			throw new Error('Wrong path in patch[' + i +']. Only paths with 1 or 2 tokens are valid');
		
		// obtengo la key (a comprobar con mel) y el índice ind (si existe)
		// hay que hacer el escapado de "~" y "/"
		const key = tokens[1].replace(/~1/g, '/').replace(/~0/g, '~');
		const ind = tokens[2] == null? 
			null : tokens[2].replace(/~1/g, '/').replace(/~0/g, '~'); // cuidado, ind es una cadena
		
		// obtengo el subelemento al que aplica key
		const subel = melext.types.find(el => el.label === key) ??
			melext.props.find(el => el.label === key);
		
		// si no existe en el modelo...
		if (subel == null) {
			throw new Error('Wrong path in patch[' + i +']. The element with id "' + mel.id 
				+ '" in the API does not have a member with key "' + key + '"');
		}
		
		// comprobación de subel no actualizable. No permito:
		// 1) property path (que no sea un simple ^)	
		// 2) no vale property path inversa ^ con datatype
		// 3) tampoco vale altResult
		// pero permito restricciones (que no se van a procesar al actualizar)
		// 1) property path: sólo valen <iri> y ^iri
		if (subel.propexpr && !subel.propexpr.match(/^(\^)?<([^>]+)>$/)) {
			throw new Error(
				`Wrong path in patch[${i}]. The member "${key}" of element "${mel.id}" in the API cannot be written due to property paths in "propexpr"`
			);
		}
		// 2) no vale property path inversa ^ con datatype
		if (subel.proptype === "datatype" && subel.propexpr?.startsWith("^")) {
			throw new Error(
				`Wrong path in patch[${i}]. The member "${key}" of element "${mel.id}" in the API cannot be written due to the inverse property path in "propexpr"`
			);
		}
		
		// 3) tampoco vale altResult
		if (subel.altResult) {
			throw new Error(
				`Wrong path in patch[${i}]. The member "${key}" of element "${mel.id}" in the API cannot be written due to "altResult"`
			);
		}
		
		// validamos que soporte sparql update
		const ep = api.endpointsById[subel.endpoint];
		if (ep.sparqlUpdate == null)
			throw new Error('Resource not updatable. Updating resource data at ' 
				+ mel.id + "." + key + ' requires SPARQL Update support at endpoint ' + ep.id);
		
		// validamos que el índice esté bien
		if (ind != null) {
			if (ind === '-') {// sólo válido en peticiones add
				if (pe.op !== "add") 
					throw new Error('Wrong path in patch[' + i +']. "-" is only valid in add operations');
			} else {
				// ind debe ser un entero no negativo
				if (!/^\d+$/.test(ind))
					throw new Error('Wrong path in patch[' + i +']. "' + ind + '" has to be a nonnegative integer');	
			}
		}		
		
		// validación del value
		if (pe.value != null) {
			// formateo como array si hace falta
			let valores = pe.value;
			if (!Array.isArray(valores)) // convierto en array
				valores = [pe.value];			
			// si hay índice no puede haber varios valores
			if (ind != null && valores.length > 1)
				throw new Error('Bad format of value at patch[' + i +']. It cannot be an array');
			// analizo cada valor según el tipo de subelemento
			for (let j=0; j<valores.length; j++) {
				const valor = valores[j];
				// valor no puede ser null
				if (valor == null)
					throw new Error('Bad format of value[' + j + '] at patch[' + i + ']');
				// valor no puede ser un array a su vez
				if (Array.isArray(valor))
					throw new Error('Bad format of value[' + j + '] at patch[' + i +']');
				// validación por tipo de subelemento
				if (subel.proptype === "datatype") {
					if (typeof valor === 'object') {
						// el literal podría ser un objeto con una clave y de valor un literal
						const keys = Object.keys(valor);
						if (keys.length === 1) {
							const mikey = keys[0];
							if (typeof valor[mikey] !== 'object')
								continue; // válido
						}			
						throw new Error('Bad format of value[' + j + '] at patch[' + i +']');
					}
				}
				else { // type o object prop
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
						// hago comprobación del objeto embebido (llamada recursiva)
						const evmel = api.modelById[subel.targetId];
						if (evmel == null)
							throw new Error('Bad format of value[' + j + '] at patch[' + i +']. Cannot embed an object for this API model element');
						const newsource = "value[" + j + "]";
						try {
							validateResource(valor.iri, valor, evmel, api, newsource);
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
	for (const par of qtemp.parameters) {
		// si existe el parámetro en la petición...
		if (objpars[par.label] != null) {
			// 2021-10-27 incluyo soporte a arrays
			let tipo = par.type;
			// ajuste tipo para arrays
			if (par.type.endsWith('[]')) 
				tipo = par.type.substring(0, par.type.length -2);
			else { // si es un array lanzo error
				if (Array.isArray(objpars[par.label])) {
					throw new Error('The value of parameter "' + par.label + 
						'" is not of type "' + par.type + '"');	
				}
			}
			
			// convierto en array para comprobación de parámetros genérica
			let valores = objpars[par.label];
			if (!Array.isArray(valores)) // convierto en array
				valores = [objpars[par.label]];
		
			// compruebo si el parámetro es del tipo adecuado (y convierto a número si hace falta)
			try {
				for (let j=0; j<valores.length; j++) {
					// extraigo valor
					let valor = valores[j];
					// analizo según el tipo
					switch(tipo) {
						case "iri":
							// lanza una excepción si la URL no es válida: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
							new URL(valor); 
							break;
						case "string":
							if (typeof valor !== "string")
								throw new Error("Invalid type");
							break;
						case "integer":
							// convertimos a número y comprobamos que es un entero
							valor = Number(valor);
							//console.log( "Valor: " + valor + " - es entero: " + Number.isInteger(valor));
							if ( !Number.isInteger(valor) )
								throw new Error("Invalid type");
							// fue bien, actualizo objpars[par.label] si no es un array
							if (!Array.isArray(objpars[par.label]))
								objpars[par.label] = valor;								
							break;
						case "number":
							// convertimos a número y comprobamos que la conversión fue bien
							valor = Number(valor);
							//console.log( "Valor: " + valor + " - no es un número: " + isNaN(valor));
							if ( isNaN(valor) )	
								throw new Error("Invalid type");							
							// fue bien, actualizo objpars[par.label] si no es un array
							if (!Array.isArray(objpars[par.label]))
								objpars[par.label] = valor;
							break;
						case "boolean":
							// parseo de la cadena
							valor = JSON.parse(valor.toLowerCase());
							//console.log( "Valor: " + req.query[par.label] + " - parseado: " + valor);
							// comprobación de booleano
							if (valor !== true && valor !== false)
								throw new Error("Invalid type");														
							// fue bien, actualizo objpars[par.label] si no es un array
							if (!Array.isArray(objpars[par.label]))
								objpars[par.label] = valor;
							break;
						default:
							throw new Error("Unknown type");
							break;
					}
				}				
			} catch(error) {
				// tipo de parámetro incorrecto
				throw new Error('The value of parameter "' + par.label + 
					'" is not of type "' + par.type + '"');
			}
		} else if (par.optional == null || !par.optional) {
			// petición incorrecta, parámetro requerido
			throw new Error('The query template "' + qtemp.id + 
				'" requires query parameter "' + par.label + '"');
		}			
	}
}


// VALIDACIÓN DE LAS CONFIGURACIONES DE DUMPS
function validateDumpConfig(dc, api) {
	// estructura de parameters asegurada por openApiValidator
	
	const apiconfig = api.config;

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
				valid = extractStepParameter("id", step, i, dc);
				// validamos con el modelo
				if (valid.type == null) {
					//const mel = apiconfig.model.find(el => el.id === valid);
					const mel = api.modelById[valid];
					if (mel == null)
						throw new Error('Wrong model id in steps[' + i + '].parameters.id. Check your API model');
					// existe mel, todo bien
				} else // viene de un step previo, comprobamos estructura con api
					checkStepresultWithApiconfig(valid, api);
				
				// tiene que haber un parámetro "iri"
				const valiri = extractStepParameter("iri", step, i, dc);
				// validamos la IRI
				if (valiri.type == null) {
					try { 
						new URL(valiri);
					} catch(err) {
						throw new Error('Wrong IRI format in steps[' + i + '].parameters.iri. ' + err.message);
					}				
					// IRI válida
				} else // viene de un step previo, comprobamos estructura con api
					checkStepresultWithApiconfig(valiri, api);				
				break;
			case "resources":
				// tiene que haber un parámetro "id"
				valid = extractStepParameter("id", step, i, dc);
				// validamos con el modelo
				if (valid.type == null) {
					const mel = api.modelById[valid];
					if (mel == null)
						throw new Error('Wrong model id in steps[' + i + '].parameters.id. Check your API model');
					// existe mel, todo bien
				} else // viene de un step previo, comprobamos estructura con api
					checkStepresultWithApiconfig(valid, api);
				
				// tiene que haber un parámetro "iris"
				let valiris = extractStepParameter("iris", step, i, dc);
				if (valiris.type != null) // viene de un step previo, comprobamos estructura con api
					checkStepresultWithApiconfig(valiris, api);
				else {
					// antes de validar las iris miramos parámetros opcionales ns y nspref
					let comprobariris = true;
					try {
						// extraigo parámetros opcionales
						const ns = extractStepParameter("ns", step, i, dc);
						const nspref = extractStepParameter("nspref", step, i, dc);
						if (ns.type != null || nspref.type != null) {
							// caso muy raro, los valores de ns y/o nspref vienen de un step anterior
							comprobariris = false; // no podemos validar las iris
						}
						else { // hacemos las sustituciones que hagan falta
							const nsprefPlus = `${nspref}:`;
							valiris = valiris.map(iri => iri.startsWith(nsprefPlus)?
								iri.replace(nsprefPlus, ns) : iri);
						}						
					} catch(err) {
						// no hacemos nada aquí al ser parámetros opcionales
					}
					if (comprobariris) {
						try {
							for (const iri of valiris)
								new URL(iri);
						} catch(err) {
							throw new Error(`Wrong IRI format in steps[${i}].parameters.iris. ${err.message}`);
						}
					}
				}			
				break;
			case "query":
				// tiene que haber un parámetro "id"
				valid = extractStepParameter("id", step, i, dc);
				// validamos con la query template
				if (valid.type == null) {
					//const qt = apiconfig.queryTemplates.find(el => el.id === valid);
					const qt = api.qtempsById[valid];
					if (!qt)
						throw new Error(`Wrong query template id in steps[${i}].parameters.id. Check your API query templates`);
					// existe qt, comprobamos ahora los parámetros
					for (const par of qt.parameters) {					
						// si existe el parámetro en el step...						
						if (step.parameters[par.label] != null) {
							// extraigo valor
							let parval = extractStepParameter(par.label, step, i, dc);
							if (parval.type != null) { // viene de un step previo, comprobamos estructura con api
								checkStepresultWithApiconfig(parval, api);
								continue;	
							}
												
							// compruebo si el parámetro es del tipo adecuado
							// TODO: habría que incluir arrays
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
										if ( Number.isNaN(parval) )
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
								throw new Error(`Query template parameter ${par.label} in steps[${i}].parameters is not of type ${par.type}`);
							}
							
						} else if (!par.optional) {
							// configuración incorrecta, parámetro requerido
							throw new Error(`Missing query template parameter ${par.label} in steps[${i}].parameters. Check your API query templates`);
						}					
					} // <- for qt.parameters
				} else // viene de un step previo, comprobamos estructura con api
					checkStepresultWithApiconfig(valid, api);
				break;
		} // <- switch step.type
	} // <- for steps
	
	// validamos los outputs
	for (const [i, output] of dc.output.entries()) {
		if (output.source === "parameters") { // si se trata de un parameter...
			if (output.key == null)
				throw new Error(`Missing output[${i}].key`);
			if (dc.parameters == null || dc.parameters[output.key] == null)
				throw new Error(`Missing parameters.${output.key}`);
		}
		else if (output.source === "steps") { // si es un step previo...
			if (output.id == null)
				throw new Error(`Missing output[${i}].id`);
			if (!dc.steps.some(el => el.id === output.id)) {
				throw new Error(
					`Wrong previous step referenced in output[${i}].id`
				);
			}
		}
	}
	
	return; // no hay más que hacer
}


function extractStepParameter(plab, step, i, dc) {
    const param = step.parameters[plab];
    
    if (param == null)
        throw new Error(`Missing steps[${i}].parameters.${plab}`);

    if (param.source === "steps") {
        // obtengo step al que hace referencia
        let prevstep;
        let stepRefNum;

        for (const [j, evstep] of dc.steps.entries()) {
            if (j >= i)
                break;
            if (evstep.id === param.id) {
                prevstep = evstep;
                stepRefNum = j;
                break;
            }
        }

        if (!prevstep) {
            throw new Error(
                `Wrong previous step referenced in steps[${i}].parameters.${plab}.id`
            );
        }

        // hay prevstep, preparo objeto de respuesta
        const resp = {
            type: prevstep.type,
            stepNum: i,
            stepRefNum
        };

        if (prevstep.type === "query") { // en las peticiones de tipo query...
            // tiene que haber variable para extraer el valor
            if (param.variable == null) {
                throw new Error(
                    `Missing steps[${i}].parameters.${plab}.variable`
                );
            }
            resp.variable = param.variable;
        } else { // en las peticiones de tipo resource/resources...
            // tiene que haber key para extraer el valor
            if (param.key == null) {
                throw new Error(
                    `Missing steps[${i}].parameters.${plab}.key`
                );
            }
            resp.key = param.key;
        }

        // extraigo el id de la template query o petición resource/resources
        resp.id = extractStepParameter("id", prevstep, stepRefNum, dc);
		// devuelvo el objeto con la info para validar con el modelo
        return resp;
    }

    if (param.source === "parameters") {
        // comprobación redundante, hecha en openApiValidator...
        if (param.key == null) {
            throw new Error(
                `Missing steps[${i}].parameters.${plab}.key`
            );
        }
		// extraigo valor de los parámetros
        if (dc.parameters == null || dc.parameters[param.key] == null)
            throw new Error(`Missing parameters.${param.key}`);
        return dc.parameters[param.key];
    }
    
    return param;
}


function checkStepresultWithApiconfig(stepr, api) {
    if (stepr.type === "query") {
        // tiene que existir la query template correspondiente
        //const qt = apiconfig.queryTemplates.find(el => el.id === stepr.id);
        const qt = api.qtempsById[stepr.id];
        
        if (!qt) {
            throw new Error(
                `Wrong query template id in steps[${stepr.stepRefNum}].parameters.id. Check your API query templates`
            );
        }

        // compruebo que exista una variable que coincida
        if (!qt.variables.includes(stepr.variable)) {
            throw new Error(
                `Wrong query template variable in steps[${stepr.stepNum}].parameters.variable. Check your API query templates`
            );
        }
    } else { // petición tipo resource / resources
		// tiene que existir el mel correspondiente en el modelo
        //const mel = apiconfig.model.find(el => el.id === stepr.id);
        const mel = api.modelById[stepr.id];

        if (!mel) {
            throw new Error(
                `Wrong model id in steps[${stepr.stepRefNum}].parameters.id. Check your API model`
            );
        }

        // 2021-11-05 trabajo aquí con melext para manejar bien las herencias
        const melext = dataManager.getExtendedMel(api, mel);

		// compruebo que exista una label que coincida con la key proporcionada en stepr
        const labels = [
            ...melext.props.map(el => el.label),
            ...melext.types.map(el => el.label)
        ];

        if (!labels.includes(stepr.key)) {
            throw new Error(
                `Wrong key in steps[${stepr.stepNum}].parameters.key. Check your API model`
            );
        }
    }
}


module.exports = {
	validateApi,
	validateResource,
	validatePatch,
	validateQuery,
	validateDumpConfig
}