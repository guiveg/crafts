#!/bin/env node

// CRAFTS App: Configurable RESTful APIs For Triple Stores

// librerías externas
const express = require('express');
const bodyParser = require('body-parser');
const responseTime = require('response-time');
const swaggerUi = require('swagger-ui-express');
const openApiValidator = require('express-openapi-validator');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// librerías propias
const config = require('./data/config');
const apiManager = require('./js/apiManager');
const logger = require('./js/logger');
const swaggerSpec = require('./js/swaggerSpec');
const util = require('./js/util'); // para el hash


// inicializo app
const app = new express();
app.use(cors()); // habilito cors en todas las rutas
app.set('trust proxy', true); // para registrar correctamente la IP del cliente


// inicializo rutas
const getRoutes = { };
const postRoutes = { };
const putRoutes = { };
const patchRoutes = { };        
const deleteRoutes = { };

function initServer() {
	// GET routes
	getRoutes['/users'] = apiManager.getUsers;
	getRoutes['/users/:login'] = apiManager.getUser;
	getRoutes['/users/:login/:actKey'] = apiManager.activateUser; // para activar a un usuario
	getRoutes['/apis'] = apiManager.getApis;
	getRoutes['/apis/:apiId'] = apiManager.getApi;
	getRoutes['/apis/:apiId/resource'] = apiManager.getResource;
	getRoutes['/apis/:apiId/resources'] = apiManager.getResources;
	getRoutes['/apis/:apiId/query'] = apiManager.answerQuery;
	getRoutes['/apis/:apiId/dumps'] = apiManager.getListOfDumps;
	getRoutes['/apis/:apiId/dumps/:dumpId'] = apiManager.getDump;	

	// POST routes
	postRoutes['/users'] = apiManager.postUser; // para solicitar creación usuario
	postRoutes['/apis/:apiId/tokens'] = apiManager.regenerateTokens; // para regenerar los tokens de acceso
	postRoutes['/apis/:apiId/dumps'] = apiManager.createDump;
	postRoutes['/apis/:apiId/cleanCache'] = apiManager.cleanCacheApi;	
	
	// PUT routes
	putRoutes['/users/:login'] = apiManager.putUser;
	putRoutes['/apis/:apiId'] = apiManager.putApi;
	putRoutes['/apis/:apiId/resource'] = apiManager.putResource;
	
	// PATCH routes
	patchRoutes['/apis/:apiId/resource'] = apiManager.patchResource;
	
	// DELETE routes
	deleteRoutes['/users/:login'] = apiManager.deleteUser;		
	deleteRoutes['/apis/:apiId'] = apiManager.deleteApi;
	deleteRoutes['/apis/:apiId/resource'] = apiManager.deleteResource;
	deleteRoutes['/apis/:apiId/dumps/:dumpId'] = apiManager.deleteDump;
	
	// parse application/x-www-form-urlencoded
	app.use(bodyParser.urlencoded({ extended: true }));

	// parse application/json
	app.use(bodyParser.json({ limit: '50mb' })); // 2025/01/12 añadido el límite
	
	// 30-12-2020 documentación con swagger-jsdoc y swagger-ui-express (no hago logging de ésta)
	const swaggerOptions = {  
		customSiteTitle: 'CRAFTS Service', 
		customCss: '.topbar { display: none }'
	};
	app.use(
		'/docs/',
		swaggerUi.serve,
		swaggerUi.setup(swaggerSpec, swaggerOptions)
	);
		
	// logging
	app.use(responseTime((req, res, time) => {
		// descarto las peticiones favicon.ico
		if (req.path === '/favicon.ico')
			return;
			
		// tipo de log según el código HTTP de la respuesta
		let loglev = "";
		if (res.statusCode >= 100) 
			loglev = "info";
		if (res.statusCode >= 400) 
			loglev = "warn";
		if (res.statusCode >= 500) 
			loglev = "error";
	
		// preparo mensaje de log
		const logmess = {};
		// info HTTP
		logmess.method = req.method;
		logmess.url = req.url;
		logmess.status = res.statusCode;
		// petición
		if (req.quuid != null)
			logmess.reqId = req.quuid;
		// usuario 
		if (req.login != null)
			logmess.user = req.login;
		if (req.token != null)
			logmess.token = req.token;				
		// IP del cliente
		if ( (req.headers['x-forwarded-for'] || req.connection.remoteAddress) != null )
			logmess.clientIP = (req.headers['x-forwarded-for'] || req.connection.remoteAddress).split(':').pop();
		// mensaje de error
		if (res.errorMessage != null)
			logmess.error = res.errorMessage;
		// localización del recurso creado con peticiones POST
		if (res.loc != null)
			logmess.location = res.loc;
		// apiId
		if (req.params != null && req.params.apiId != null)
			logmess.apiId = req.params.apiId;
		// info consultas
		if (res.cached != null)	// de las consultas parametrizadas
			logmess.cached = res.cached;
		if (res.numberOfQueries != null)
			logmess.numberOfQueries = res.numberOfQueries;
		if (res.allQueries != null)
			logmess.allQueries = res.allQueries;
		if (res.numberOfQueries != null && res.allQueries != null && res.allQueries > 0)
			logmess.percCacheHit = Number((100 * (res.allQueries - res.numberOfQueries) / res.allQueries).toFixed(2));
		// info actualizaciones
		if (res.deletedTriples != null)
			logmess.deletedTriples = res.deletedTriples;
		if (res.insertedTriples != null)
			logmess.insertedTriples = res.insertedTriples;
		// tiempo para resolver la petición en milisegundos
		logmess.timeMilliseconds = Number(time.toFixed(2));
	
		// hago logging...
		logger.log({
			level: loglev,
			message: logmess
		});
		
		// 04-02-2021 analíticas previas
		// 07-10-2026 analíticas revisadas para GA4
		if (config.gaMeasurementId != null) {
			// preparo id de usuario anónimo
			let ida;
			if (req.login != null)
				ida = util.getHash( req.login );
			else if (req.token != null)
				ida = util.getHash( req.token + logmess.clientIP );
			else
				ida = util.getHash( logmess.clientIP );
				
			// preparo datos evento
			const evdata = {};
			// apiId
			if (logmess.apiId != null)
				evdata.api_id = logmess.apiId;
			// detecto categoría de la llamada
			if (req.url === '/')
				evdata.cat = 'index';
			else if (req.url === '/users')
				evdata.cat = 'users';
			else if (req.url.includes('/users/') && req.url.split('/').length == 4)
				evdata.cat = 'actKey';
			else if (req.url.includes('/users/'))
				evdata.cat = 'user';
			else if (req.url === '/apis')
				evdata.cat = 'apis';
			else if (req.url.includes('/apis/') && req.url.includes('/tokens'))
				evdata.cat = 'apiTokens';
			else if (req.url.includes('/apis/') && req.url.includes('/resources'))
				evdata.cat = 'resources';
			else if (req.url.includes('/apis/') && req.url.includes('/resource'))
				evdata.cat = 'resource';
			else if (req.url.includes('/apis/') && req.url.includes('/query'))
				evdata.cat = 'query';
			else if (req.url.includes('/apis/') && req.url.includes('/dumps') && req.url.split('/').length == 5)
				evdata.cat = 'dump';
			else if (req.url.includes('/apis/') && req.url.includes('/dumps'))
				evdata.cat = 'dumps';
			else if (req.url.includes('/apis/') && req.url.split('/').length == 3)
				evdata.cat = 'api';
			else
				return;
			// extraigo id (para resources, queries y dumps)
			if (req.query.id != null)
				evdata.id = req.query.id;
			if (evdata.cat === 'resources' && req.query.iris != null)
				evdata.num_resources = req.query.iris.length;
			// método
			evdata.method = req.method;
			// resultado
			evdata.status_code = res.statusCode;
			// duración (ms)
			evdata.duration_ms = Number(time.toFixed(0));
			// info consultas
			if (logmess.cached != null)
				evdata.cached = logmess.cached;
			if (logmess.numberOfQueries != null)
				evdata.sent_queries = logmess.numberOfQueries;
			if (logmess.percCacheHit != null)
				evdata.cache_hit_pct = logmess.percCacheHit;
			// info actualizaciones
			if (logmess.insertedTriples != null)
				evdata.inserted_triples = logmess.insertedTriples;
			if (logmess.deletedTriples != null)
				evdata.deleted_triples = logmess.deletedTriples;
			
			// mando el evento con las analíticas
			sendAnalytics(ida, evdata);
		}
	}));
	
	// 03-02-2021 sirvo los logs al root
	app.use('/logs', function (req, res, next) {		
		// cojo login y password
		const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
		const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
		// valido el usuario (aunque sólo permito acceso al root)
		const user = apiManager.retrieveUser(login);
		if (user != null) {
			// con cuenta activada y con coincidencia de password
			if (user.activationKey == null && user.password === password) {
				// usuario válido, guardo el login en req
				req.login = login;
				// pero sólo permito acceso al root
				const root = apiManager.retrieveUser('root');
				if (login === 'root' && password === root.password) {
					// acceso válido
					req.login = login;
					next();
					return;
				}
				// acceso prohibido
				let err = new Error('Forbidden');
				err.status = 403;
				throw err;
			}
		} 
		// sin autorización
		const err = new Error('Unauthorized');
		err.status = 401;
		throw err;
	});
	app.use('/logs', express.static('logs'));
	
	// 4-1-2021 openApiValidator para validar las peticiones
	swaggerSpec.servers = [ { 'url': '' } ]; // redefino para que funcione el validador
	app.use(
		openApiValidator.middleware({
			apiSpec: swaggerSpec,
			validateRequests: {
				// necesario para incluir parámetros en GET /apis/{apiId}/query
				allowUnknownQueryParameters: true
			},
			validateResponses: true, // <-- to validate responses
			
			// validación de seguridad con openApiValidator:
			// compruebo credenciales aquí e incluyo cabecera 'WWW-Authenticate' en tratamiento de errores		
			validateSecurity: {
				handlers: {
					// 30-01-2021 nueva validación => sólo credenciales válidas, no si tiene permiso
					BasicAuth: (req, scopes, schema) => {													
						// cojo login y password
						const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
						const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
						// valido el usuario
						const user = apiManager.retrieveUser(login);
						if (user != null) {
							// con cuenta activada y con coincidencia de password
							if (user.activationKey == null && user.password === password) {
								// usuario válido, guardo el login en req
								req.login = login;
								return Promise.resolve(true);
							}
						}						
						// si llega aquí, no hay coincidencia
						return Promise.resolve(false);
					},
					BearerAuth: async (req, scopes, schema) => {
						// cojo el token y lo guardo en req (se encargará el apiManager de validar el token)
						const token = (req.headers.authorization || '').split(' ')[1] || '';
						if (token != null) {
							req.token = token;
							return Promise.resolve(true);
						}
						return Promise.resolve(false); // no hay token ¿?
					}
				}
			}
		})
	);
	
	// genero uuid de petición para las llamadas a la API
	app.use(function (req, res, next) {
		req.quuid = uuidv4(); // UUID para trazar las consultas al log					
		next();
	});
	
	//  Add handlers for the app (from the routes).
	// GET routes
	for (let r in getRoutes) 
		app.get(r, getRoutes[r]);
	// POST routes        
	for (let r in postRoutes)
		app.post(r, postRoutes[r]);
	// PUT routes        
	for (let r in putRoutes)
		app.put(r, putRoutes[r]);
	// PATCH routes        
	for (let r in patchRoutes)
		app.patch(r, patchRoutes[r]);
	// DELETE routes        
	for (let r in deleteRoutes)
		app.delete(r, deleteRoutes[r]);
			
	// 4-1-2021 error handler de openApiValidator 
	app.use((err, req, res, next) => {
		// preparo objeto de respuesta
		const objresp = {};			
		// pongo código de error
		objresp.status = err.status || 500; // error 500 si no viene incluido...
		// pongo mensaje
		objresp.message = err.name + ": " + err.message;
		// pongo mensaje de error en la respuesta
		res.errorMessage = objresp.message;
		
		// en caso de fallo de autenticación incluyo la cabecera 'WWW-Authenticate' para pedir credenciales desde el navegador
		if (objresp.status == 401)
			res.set('WWW-Authenticate', 'Basic realm="Access to CRAFTS"');
		
		// devuelvo la respuesta (no hago logging aquí, se hará al tratar la respuesta)
		res.status(objresp.status).json(objresp);		
	});
}

function sendAnalytics(clientId, params) {
	// preparo un controlador para abortar la conexión si no responde en 1s
	const controller = new AbortController();
 	const timeout = setTimeout(() => {
		controller.abort();
	}, 1000);
	
	const url =	`${config.gaURLbase}?measurement_id=${config.gaMeasurementId}` +
		`&api_secret=${config.gaApiSecret}`;

	const body = {
		client_id: clientId,
		events: [{
			name: 'api_call',
			params
		}]
	};

	// mando los datos
	fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	})
	.finally(() => {
		clearTimeout(timeout);
	})
	.catch(() => {
		// ignoramos errores
	});
}

function startServer() {    
    //  Start the app on the specific interface (and port).
	app.listen(config.port, function() {        	
		logger.info('CRAFTS server started on port ' + config.port);
    });
}

async function start() {
	// Inicializo usuarios y APIs
	await apiManager.init();
        
    // Configuro servidor y rutas
	initServer();
	
	// llamo a empezar el servidor
	startServer();
}


/**
 *  main():  Main code.
 */
start();
