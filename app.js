#!/bin/env node

// CRAFTS App: Configurable RESTful APIs For Triple Stores

// librerías externas
const express = require('express');
const bodyParser = require('body-parser');
const responseTime = require('response-time');
const swaggerUi = require('swagger-ui-express');
const openApiValidator = require('express-openapi-validator');
const { v4: uuidv4 } = require('uuid');
const univAnalytics = require('universal-analytics');
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
let getRoutes = { };
let postRoutes = { };
let putRoutes = { };
let patchRoutes = { };        
let deleteRoutes = { };

function initServer() {
	// preparo rutas
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
	app.use(bodyParser.json());	
	
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
		// tipo de log según el código HTTP de la respuesta
		var loglev = "";
		if (res.statusCode >= 100) 
			loglev = "info";
		if (res.statusCode >= 400) 
			loglev = "warn";
		if (res.statusCode >= 500) 
			loglev = "error";
	
		// preparo mensaje de log
		let logmess = {};
		// info HTTP
		logmess.method = req.method;
		logmess.url = req.url;
		logmess.status = res.statusCode;
		// petición
		if (req.quuid != undefined)
			logmess.reqId = req.quuid;
		// usuario 
		if (req.login != undefined)
			logmess.user = req.login;
		if (req.token != undefined)
			logmess.token = req.token;				
		// IP del cliente
		if ( (req.headers['x-forwarded-for'] || req.connection.remoteAddress) != undefined )
			logmess.clientIP = (req.headers['x-forwarded-for'] || req.connection.remoteAddress).split(':').pop();
		// mensaje de error
		if (res.errorMessage != undefined)
			logmess.error = res.errorMessage;
		// localización del recurso creado con peticiones POST
		if (res.loc != undefined)
			logmess.location = res.loc;
		// apiId
		if (req.params != undefined && req.params.apiId != undefined)
			logmess.apiId = req.params.apiId;
		// info consultas
		if (res.numberOfQueries != undefined)
			logmess.numberOfQueries = res.numberOfQueries;
		if (res.allQueries != undefined)
			logmess.allQueries = res.allQueries;
		if (res.numberOfQueries != undefined && res.allQueries != undefined && res.allQueries > 0)
			logmess.percCacheHit = Number((100 * (res.allQueries - res.numberOfQueries) / res.allQueries).toFixed(2));
		// info actualizaciones
		if (res.deletedTriples != undefined)
			logmess.deletedTriples = res.deletedTriples;
		if (res.insertedTriples != undefined)
			logmess.insertedTriples = res.insertedTriples;
		// tiempo para resolver la petición en milisegundos
		logmess.timeMilliseconds = Number(time.toFixed(2));
	
		// hago logging...
		logger.log({
			level: loglev,
			message: logmess
		});
		
		// 04-02-2021 analíticas
		if (config.gaTrackId != undefined) {
			// preparo id de usuario anónimo
			let ida;
			if (req.login != undefined)
				ida = util.getHash( req.login );
			else if (req.token != undefined)
				ida = util.getHash( req.token + logmess.clientIP );
			else
				ida = util.getHash( logmess.clientIP );
			
			// preparo visitante para las analíticas
			let visitor = univAnalytics(config.gaTrackId, ida, {strictCidFormat: false});
			
			// preparo datos evento
			let evdata = {};
			// Event category.
			if (req.url === '/')
				evdata.ec = 'index';
			else if (req.url === '/users')
				evdata.ec = 'users';
			else if (req.url.includes('/users/') && req.url.split('/').length == 4)
				evdata.ec = 'actKey';
			else if (req.url.includes('/users/'))
				evdata.ec = 'user';
			else if (req.url === '/apis')
				evdata.ec = 'apis';
			else if (req.url.includes('/apis/') && req.url.includes('/tokens'))
				evdata.ec = 'apiTokens';
			else if (req.url.includes('/apis/') && req.url.includes('/resources'))
				evdata.ec = 'resources';
			else if (req.url.includes('/apis/') && req.url.includes('/resource'))
				evdata.ec = 'resource';
			else if (req.url.includes('/apis/') && req.url.includes('/query'))
				evdata.ec = 'query';
			else if (req.url.includes('/apis/') && req.url.includes('/dumps') && req.url.split('/').length == 5)
				evdata.ec = 'dump';
			else if (req.url.includes('/apis/') && req.url.includes('/dumps'))
				evdata.ec = 'dumps';
			else if (req.url.includes('/apis/') && req.url.split('/').length == 3)
				evdata.ec = 'api';
			// Event action.
			evdata.ea = req.method;
			// Event label.
			if (logmess.apiId != undefined)
				evdata.el = logmess.apiId;
			// Event value.
			evdata.ev = res.statusCode;
			// Event path.
			evdata.dp = req.url;			
			
			// prepara datos timing
			let tmdata = {
				utc: evdata.ec, // categoría
				utv: req.method, // variable de medida
				utt: Number(time.toFixed(0)) // medida en ms
			};
			// si hay api, va como label
			if (logmess.apiId != undefined)
				tmdata.utl = logmess.apiId;
						
			// hago daisy chaining de visita a página, evento y timing
			visitor
				.pageview(req.url)
				.event(evdata)
				.timing(tmdata)
				.send();
		}
	}));
			
	// 02-02-2021 sirvo la página de índice aquí para que no me la corte el validador
	app.get('/', apiManager.getIndex);
	// 09-02-2021 sirvo los recursos en el directorio 'html' (CRAFTSconfig101.html)
	app.use('/', express.static('html'));
	
	// 07-02-2021 sirvo guía de configuración
	//app.get('/CRAFTSconfig101', apiManager.getConfigGuide);
	
	// 03-02-2021 sirvo los logs al root
	app.use('/logs', function (req, res, next) {		
		// cojo login y password
		const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
		const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
		// valido el usuario (aunque sólo permito acceso al root)
		const user = apiManager.retrieveUser(login);
		if (user != undefined) {
			// con cuenta activada y con coincidencia de password
			if (user.activationKey == undefined && user.password === password) {
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
		let err = new Error('Unauthorized');
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
						if (user != undefined) {
							// con cuenta activada y con coincidencia de password
							if (user.activationKey == undefined && user.password === password) {
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
						if (token != undefined) {
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
		let objresp = {};			
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
		
	// programo limpieza periódica de la caché
	//setInterval(apiManager.cleanCache, 60000); // cada minuto
	setInterval(apiManager.cleanCache, config.millisecsCleanCache);
}


/**
 *  main():  Main code.
 */
start();
