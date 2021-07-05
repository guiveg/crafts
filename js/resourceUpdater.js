const _ = require('underscore');
const dataManager = require('./dataManager');


// CREACIÓN/REEMPLAZO DE RECURSO
async function putResource(iri, objr, mel, api, qinfo) {
	// 2021-mar incluyo datos writeonly en la definición del modelo		
	// primero borro el recurso de la caché (para pedir de los endpoints todos los datos, incluidos los de solo escritura)
	delete api.cache[mel.id][iri];

	// luego pido los datos del recurso en cuestión incluyendo datos de escritura (para poder borrarlos)
	let obj = {};
	obj.api = api;
	obj.id = mel.id;
	obj.iris = [ iri ];
	// recupero datos,  incluyendo datos de escritura (la caché de la API se actualizará automáticamente)
	let datos = await dataManager.getData(obj, qinfo, true); // en datos.data[0] habrá una representación del recurso
	
	// objeto donde guardo los recursos a borrar de la caché
	let borrar = {};
	
	// obtengo las triplas para borrar en los endpoints que soporten SPARQL Update
	let edt = getEndpointTriples(false, iri, datos.data[0], mel, api, borrar);

	// obtengo las triplas para insertar en los endpoints que soporten SPARQL Update
	let eit = getEndpointTriples(true, iri, objr, mel, api, borrar);
	
	// inicializo objeto a devolver
	let resp = {
		deletedTriples: 0,
		insertedTriples: 0,
		numberOfQueries: 0
	};
	
	// hago las borrados
	for (const epid in edt) {
		if (edt[epid].length > 0) {
			// preparo la consulta
			let qt = {};			
			qt.template = getUpdateOperation(false, edt[epid]);			
			// pido el borrado
			const ep = _.find(api.config.endpoints, el => el.id === epid);
			await dataManager.answerQuery(ep.sparqlUpdate, qt, {}, qinfo); //, api.config.prefixes);
			// actualizo datos a devolver
			resp.deletedTriples += edt[epid].length;
			resp.numberOfQueries ++;
		}	
	}
	
	// hago las inserciones
	for (const epid in eit) {
		if (eit[epid].length > 0) {	
			// preparo la consulta
			let qt = {};			
			qt.template = getUpdateOperation(true, eit[epid]);			
			// pido la inserción
			const ep = _.find(api.config.endpoints, el => el.id === epid);
			await dataManager.answerQuery(ep.sparqlUpdate, qt, {}, qinfo); //, api.config.prefixes);
			// actualizo datos a devolver
			resp.insertedTriples += eit[epid].length;
			resp.numberOfQueries ++;
		}	
	}
	
	// borro recursos modificados en la caché
	for (let key in borrar) {
		for (let i=0; i<borrar[key].length; i++) {
			//console.log("Borrando de la caché de " + key + " el recurso " + borrar[key][i]);
			delete api.cache[key][borrar[key][i]];
		}
	}
	
	// y hemos terminado
	return resp;
}



// BORRADO DE RECURSO
async function deleteResource(iri, mel, api, qinfo) {
	// 2021-mar incluyo datos writeonly en la definición del modelo		
	// primero borro el recurso de la caché (para pedir de los endpoints todos los datos, incluidos los de solo escritura)
	delete api.cache[mel.id][iri];
	
	// luego pido los datos del recurso en cuestión incluyendo datos de escritura (para poder borrarlos)
	let obj = {};
	obj.api = api;
	obj.id = mel.id;
	obj.iris = [ iri ];
	// recupero datos,  incluyendo datos de escritura (la caché de la API se actualizará automáticamente)
	let datos = await dataManager.getData(obj, qinfo, true); // en datos.data[0] habrá una representación del recurso
		
	// objeto donde guardo los recursos a borrar de la caché
	let borrar = {};
	
	// obtengo las triplas para borrar en los endpoints que soporten SPARQL Update
	let edt = getEndpointTriples(false, iri, datos.data[0], mel, api, borrar);
	
	// inicializo objeto a devolver
	let resp = {
		deletedTriples: 0,
		numberOfQueries: 0
	};
	
	// hago las borrados
	for (const epid in edt) {
		if (edt[epid].length > 0) {
			// preparo la consulta
			let qt = {};			
			qt.template = getUpdateOperation(false, edt[epid]);
			// pido el borrado
			const ep = _.find(api.config.endpoints, el => el.id === epid);
			await dataManager.answerQuery(ep.sparqlUpdate, qt, {}, qinfo); //, api.config.prefixes);
			// actualizo datos a devolver
			resp.deletedTriples += edt[epid].length;
			resp.numberOfQueries ++;
		}	
	}
		
	// borro recursos modificados en la caché
	for (let key in borrar) {
		for (let i=0; i<borrar[key].length; i++) {
			//console.log("Borrando de la caché de " + key + " el recurso " + borrar[key][i]);
			delete api.cache[key][borrar[key][i]];
		}
	}
	
	// y hemos terminado
	return resp;
}



// ACTUALIZACIÓN DE RECURSO
async function patchResource(iri, patch, mel, api, qinfo) {
	// 2021-mar incluyo datos writeonly en la definición del modelo		
	// primero borro el recurso de la caché (para pedir de los endpoints todos los datos, incluidos los de solo escritura)
	delete api.cache[mel.id][iri];
	
	// luego pido los datos del recurso en cuestión incluyendo datos de escritura (para poder borrarlos)
	let obj = {};
	obj.api = api;
	obj.id = mel.id;
	obj.iris = [ iri ];
	// recupero datos,  incluyendo datos de escritura (la caché de la API se actualizará automáticamente)
	let datos = await dataManager.getData(obj, qinfo, true); // en datos.data[0] habrá una representación del recurso
	let objr = datos.data[0]; // guardo aquí la representación del recurso
				
	// objeto donde guardo los recursos a borrar de la caché
	let borrar = {};
	// meto iri del recurso a actulizar
	borrar[mel.id] = [];
	borrar[mel.id].push(iri);
	// además, hay que analizar si algún otro recurso apunta a él para eliminarlo de la caché
	actualizarIrisApuntadasBorrar(iri, mel, api, borrar);	
	
	// inicializo objeto a devolver
	let resp = {
		deletedTriples: 0,
		insertedTriples: 0,
		numberOfQueries: 0
	};

	// petición atómica: si falla algo, se haría un rollback
	// para evitar el rollback, hago las actualizaciones en la representación del recurso (objr) 
	// y encolo aquí las inserciones y borrados a hacer	
	let requests = [];
	
	// itero por cada elemento del patch
	for (let i=0; i<patch.length; i++) {
		// obtengo patch element y obtengo triplas a insertar/borrar por endpoint
		const pe = patch[i];
		try {
			requests.push(applyPatch(iri, objr, pe, mel, api, borrar));
		} catch(err) {
			if (err.status != undefined && err.status == 400)
				err.message = err.message + ' at patch[' + i +']';
			throw err;
		}
	}
	
	// resuelvo las inserciones / modificaciones en el orden pedido
	for (let i=0; i<requests.length; i++) {
		//console.log("PATCH #"+i);
		const request = requests[i];
		// hago los delete correspondientes
		for (const epid in request.edt) {
			if (request.edt[epid].length > 0) {
				// preparo la consulta
				let qt = {};			
				qt.template = getUpdateOperation(false, request.edt[epid]);
				// pido el borrado
				const ep = _.find(api.config.endpoints, el => el.id === epid);
				await dataManager.answerQuery(ep.sparqlUpdate, qt, {}, qinfo); //, api.config.prefixes);
				// actualizo datos a devolver
				resp.deletedTriples += request.edt[epid].length;
				resp.numberOfQueries ++;
			}
		}		
		// hago los insert correspondientes
		for (const epid in request.eit) {
			if (request.eit[epid].length > 0) {
				// preparo la consulta
				let qt = {};			
				qt.template = getUpdateOperation(true, request.eit[epid]);
				// pido la inserción
				const ep = _.find(api.config.endpoints, el => el.id === epid);
				await dataManager.answerQuery(ep.sparqlUpdate, qt, {}, qinfo); //, api.config.prefixes);
				// actualizo datos a devolver
				resp.insertedTriples += request.eit[epid].length;
				resp.numberOfQueries ++;
			}
		}		
	}		
		
	// borro recursos modificados en la caché
	for (let key in borrar) {
		for (let i=0; i<borrar[key].length; i++) {
			//console.log("Borrando de la caché de " + key + " el recurso " + borrar[key][i]);
			delete api.cache[key][borrar[key][i]];
		}
	}
	
	// y hemos terminado
	return resp;
}



// FUNCIONES AUXILIARES
function applyPatch(iri, objr, pe, mel, api, borrar) {
	// inicializo modificaciones a hacer
	let resp = {};
	resp.edt = {};
	resp.eit = {};
	for (let i=0; i<api.config.endpoints.length; i++) {
		resp.edt[ api.config.endpoints[i].id ] = [];
		resp.eit[ api.config.endpoints[i].id ] = [];
	};

	// obtengo datos del path
	let tokens = pe.path.split("/");
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
	
	//console.log("\nDatos básicos path:\n - path: " + pe.path + "\n - op: " + pe.op);
		
	// si no existe el miembro en el objeto...
	if (objr[key] == undefined) {
		//console.log("Operación sobre miembro inexistente en " + key); //
	
		if (pe.op !== 'add'|| ind != undefined) {
			// error en la petición
			let err = new Error('Undefined member ' + key + ' in the target resource');
			err.status = 400;
			throw err;
		} else { // petición 'add' a un miembro	=> sólo inserción		
			// actualizo primero objr
			objr[key] = pe.value;	
			// obtengo las triplas de inserción (y actualizo borrar)
			getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, tsubel, api, borrar);
		}
	} else { // existe el miembro		
		// si el path no es un array...
		if (ind == undefined) {
			// console.log("Operación sobre miembro " + key);
		
			// obtengo las triplas de borrado (común)		
			getSubelementEndpointTriples(resp.edt, false, iri, objr, subel, tsubel, api, borrar);
			// trato bifurcación
			if (pe.op === 'remove') 
				delete objr[key]; // sólo tengo que borrar el miembro
			else { // en este caso son equivalentes 'add' y 'replace'
				// actualizo primero objr
				objr[key] = pe.value;	
				// obtengo las triplas de inserción (y actualizo borrar)
				getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, tsubel, api, borrar);
			}
		} else { // el path es un array => sólo habría que actualizar un elemento del array
			// console.log("Operación sobre elemento de array en " + key + "[" + ind + "]");		
			
			// convierto en array si es necesario
			if (!Array.isArray(objr[key]))
				objr[key] = [ objr[key] ];
			
			// el truqui será cambiarle el miembro a objr y luego apañárselo
			let prevmember = objr[key]; // guardo lo que había				
			
			if (ind === '-') { // 'add' de un elemento al final
				// le enchufo como nuevo miembro el valor a insertar al final
				objr[key] = pe.value;
				// obtengo las triplas de inserción (y actualizo borrar)
				getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, tsubel, api, borrar);
				// actualizo objr con el nuevo elemento
				objr[key] = prevmember;
				objr[key].push(pe.value);
			} else {
				// compruebo si hay problemas con el índice
				const pind = Number.parseInt(ind, 10); // conversión muy optimista...
				if (objr[key][pind] == undefined) { // tiene que existir
					// error en la petición
					let err = new Error('Undefined member ' + key + '[' + pind + '] in the target resource');
					err.status = 400;
					throw err;
				}
				// actualizo
				if (pe.op !== 'add') {
					// le enchufo como miembro el valor a borrar
					objr[key] = objr[key][pind];
					// obtengo las triplas de borrado (común)		
					getSubelementEndpointTriples(resp.edt, false, iri, objr, subel, tsubel, api, borrar);
					// trato bifurcación
					if (pe.op === 'remove') {
						// actualizo objr (sólo tengo que borrar el valor del array en pind)
						objr[key] = prevmember;
						objr[key].splice(pind, 1);
					} else { // 'replace'
						// actualizo primero objr con el valor a insertar
						objr[key] = pe.value;
						// obtengo las triplas de inserción (y actualizo borrar)
						getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, tsubel, api, borrar);
						// actualizo objr (sólo tengo que reemplazar el valor del array en pind)
						objr[key] = prevmember;
						objr[key].splice(pind, 1, pe.value);
					}				
				} else { // es un 'add'
					// actualizo primero objr con el valor a insertar
					objr[key] = pe.value;
					// obtengo las triplas de inserción (y actualizo borrar)
					getSubelementEndpointTriples(resp.eit, true, iri, objr, subel, tsubel, api, borrar);
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


function getTriple(iri, valor, subel, tsubel) { // valores de tsubel => 0: type  1: oprop  2: dprop
	// inicializo la tripla	
	let tripla = {
		s: '<' + iri + '>'
	};	
	// pongo predicado apropiado
	tripla.p = tsubel == 0? '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>' : '<' + subel.iri + '>';	
	// ajusto el objeto de la tripla
	if (tsubel == 2) { // dprop
		// guardo el literal de manera apropiada en el objeto
		if (typeof valor === "object") { // string con language tag
			const mikey = Object.keys(valor)[0];
			tripla.o = '"' + valor[mikey] + '"@' + mikey;
		}
		else if (typeof valor === "string") {
			// compruebo si pudiera ser una fecha
			if ( isNaN(Date.parse(valor)) )		
				tripla.o = '"' + valor + '"';
			else // es una fecha
				tripla.o = '"' + valor + '"^^xsd:dateTime';
		}
		else
			tripla.o = valor;
	} else { // type o oprop
		// obtengo la iri objeto de manera diferente si hay algo embebido o no
		const oiri = typeof valor === "object"? valor.iri : valor;
		tripla.o = '<' + oiri + '>';
	
		// si es inversa... (sólo aplicaría en oprop)
		if (subel.inv != undefined && subel.inv) {
			const oaux = tripla.s;
			tripla.s = tripla.o;
			tripla.o = oaux;
		}	
	}	
	// devuelvo la tripla
	return tripla;
}


function getSubelementEndpointTriples(et, insert, iri, objr, subel, tsubel, api, borrar) {
	const ep = _.find(api.config.endpoints, el => el.id === subel.endpoint);
	if (ep.sparqlUpdate != undefined) { // es actualizable
		// si existe en la representación...
		if (objr[subel.label] != undefined) {
			// formateo como array si hace falta
			let valores = objr[subel.label];
			if (!Array.isArray(valores)) { // convierto en array
				valores = [];
				valores.push(objr[subel.label]);			
			}
			// para cada valor preparo una tripla y actualizo borrar
			for (let j=0; j<valores.length; j++) {
				// obtengo la tripla
				const valor = valores[j];
				const tripla = getTriple(iri, valor, subel, tsubel);				
				// incluyo la tripla
				et[ep.id].push(tripla);			
				// actualizo borrar si hay targetId (no es estrictamente necesario, pero por si acaso)
				if (subel.targetId != undefined) {
					if (borrar[subel.targetId] == undefined)
						borrar[subel.targetId] = [];
					// obtengo la iri objeto de manera diferente si hay algo embebido o no
					const oiri = typeof valor === "object"? valor.iri : valor;
					borrar[subel.targetId].push(oiri);
				}
				// si es una inserción y tsubel no es 2 (dprop) puede haber info embebida 
				// y entonces recuperar sus triplas a insertar
				if (insert && tsubel != 2 && typeof valor === "object") {
					// si hay información embebida tengo que recuperar sus triplas a insertar...
					const embmel = _.find(api.config.model, el => el.id === subel.targetId);
					const embeit = getEndpointTriples(insert, valor.iri, valor, embmel, api, borrar);
					for (let embepid in embeit) {
						if (embeit[embepid].length > 0)
							et[embepid] = et[embepid].concat(embeit[embepid]);
					}
				}				
			}
		}
	}
}

function actualizarIrisApuntadasBorrar(iri, mel, api, borrar) {
	// analizo si algún otro recurso apunta a "iri" para eliminarlo de la caché
	for (let i=0; i<api.config.model.length; i++) {
		const evmel = api.config.model[i];
		// analizo oprops
		for (let j=0; j<evmel.oprops.length; j++) {
			const oprop = evmel.oprops[j];
			if (oprop.targetId != undefined && oprop.targetId === mel.id) {
				// aquí hay candidato, analizo la caché por si apuntan a iri
				for (let eviri in api.cache[evmel.id]) {
					if (api.cache[evmel.id][eviri][oprop.label] != undefined 
							&& _.contains(api.cache[evmel.id][eviri][oprop.label], iri)) {
						// eviri apunta a iri, lo borramos de la caché
						if (borrar[evmel.id] == undefined)
							borrar[evmel.id] = [];
						borrar[evmel.id].push(eviri);						
					}				
				}
			}
		}
		// analizo types
		for (let j=0; j<evmel.types.length; j++) {
			const type = evmel.types[j];
			if (type.targetId != undefined && type.targetId === mel.id) {
				// aquí hay candidato, analizo la caché por si apuntan a iri
				for (let eviri in api.cache[evmel.id]) {
					if (api.cache[evmel.id][eviri][type.label] != undefined 
							&& _.contains(api.cache[evmel.id][eviri][type.label], iri)) {
						// eviri apunta a iri, lo borramos de la caché
						if (borrar[evmel.id] == undefined)
							borrar[evmel.id] = [];
						borrar[evmel.id].push(eviri);			
					}				
				}
			}
		}	
	}
}

function getEndpointTriples(insert, iri, objr, mel, api, borrar) {
	// incorporo iris de recursos a borrar, empezando por la iri del recurso (ya que cambiará)
	if (borrar[mel.id] == undefined)
		borrar[mel.id] = [];
	borrar[mel.id].push(iri);
	// además, hay que analizar si algún otro recurso apunta a él para eliminarlo de la caché
	actualizarIrisApuntadasBorrar(iri, mel, api, borrar);
	
	// inicializo objeto a devolver
	let et = {};
	for (let i=0; i<api.config.endpoints.length; i++)
		et[ api.config.endpoints[i].id ] = [];

	// analizo los types en mel...
	for (let i=0; i<mel.types.length; i++) {	
		const type = mel.types[i];
		getSubelementEndpointTriples(et, insert, iri, objr, type, 0, api, borrar);
	}
	
	// analizo los oprops en mel...	
	for (let i=0; i<mel.oprops.length; i++) {
		const oprop = mel.oprops[i];
		getSubelementEndpointTriples(et, insert, iri, objr, oprop, 1, api, borrar);
	}

	// analizo los dprops en mel...	
	for (let i=0; i<mel.dprops.length; i++) {
		const dprop = mel.dprops[i];
		getSubelementEndpointTriples(et, insert, iri, objr, dprop, 2, api, borrar);		
	}	

	// ordeno y quito triplas duplicadas
	for (const epid in et) {
		if (et[epid].length > 0) {	
			// ordeno triplas
			et[epid] = _.sortBy(et[epid], function(el) { return el.s + el.p + el.o; });
			// quito triplas duplicadas
			et[epid] = _.uniq(et[epid], true, function(el) { return el.s + el.p + el.o; });
		}
	}

	return et;
}

module.exports = {
	putResource,
	deleteResource,
	patchResource
}