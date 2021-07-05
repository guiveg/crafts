const fs = require('fs'); // para servir ficheros de dumps
const _ = require('underscore');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require("nodemailer");

const config = require('../data/config'); // para las URLs y locations
const logger = require('./logger'); // para el logging
const modelValidator = require('./modelValidator'); // para validar las configuraciones de las APIs
const dataManager = require('./dataManager'); // para los datos
const dumpManager = require('./dumpManager'); // para los dumps
const resourceUpdater = require('./resourceUpdater'); // para actualizar los recursos
const util = require('./util'); // para ficheros

const dirApiPath = './' + config.apisPath + '/';
const dirUsersPath = './' + config.dataPath + '/';
const usersFilePath = dirUsersPath + config.usersFile;

// objeto con todas las APIs (accesibles por clave)
var users = {};

// objeto con todas las APIs (accesibles por clave)
var apis = {};

/** 
 * @swagger 
 * tags: 
 *   - name: user 
 *     description: Operations with users
 *   - name: api 
 *     description: Operations with CRAFT APIs
 *   - name: resource
 *     description: Resource operations with a CRAFTS API
 *   - name: query
 *     description: Query operations with a CRAFTS API
 *   - name: dump
 *     description: Dump operations with a CRAFTS API 
 * 
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         login:
 *           type: string
 *         password:
 *           type: string
 *           format: password
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *       required: [login, password, firstName, lastName, email]
 *  
 *     UserData:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         login:
 *           type: string
 *         password:
 *           type: string
 *           format: password
 *         firstName:
 *           type: string
 *         lastName:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         created:
 *           type: string
 *           format: date-time
 *         activated:
 *           type: string
 *           format: date-time
 *         activationKey:
 *           type: string
 *         apis:
 *           type: object
 *           additionalProperties:
 *             type: object
 *             properties:
 *               created:
 *                 type: string
 *                 format: date-time
 *               readToken:
 *                 type: string
 *               writeToken:
 *                 type: string
 *             required: [created, readToken, writeToken]
 *       required: [login, password, email, created, apis]
 * 
 *     ApiSummary:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         apiId:
 *           type: string
 *         url:
 *           type: string
 *           format: uri
 *       required: [apiId, url]
 * 
 *     Api:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         apiId:
 *           type: string
 *         endpoints:
 *           type: array
 *           items:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               id:
 *                 type: string
 *               sparqlURI:
 *                 type: string
 *                 format: uri
 *               graphURI:
 *                 type: string
 *                 format: uri
 *               httpMethod:
 *                 type: string
 *                 enum: [GET, POST]
 *               authInfo:
 *                 type: object
 *                 additionalProperties: false
 *                 properties:
 *                   user:
 *                     type: string
 *                   password:
 *                     type: string
 *                   type:
 *                     type: string
 *                     enum: [basic, digest]
 *                 required: [user, password, type]
 *               sparqlUpdate:
 *                 type: object
 *                 additionalProperties: false
 *                 properties:
 *                   id:
 *                     type: string
 *                   sparqlURI:
 *                     type: string
 *                     format: uri
 *                   graphURI:
 *                     type: string
 *                     format: uri
 *                   httpMethod:
 *                     type: string
 *                     enum: [GET, POST]
 *                   authInfo:
 *                     type: object
 *                     additionalProperties: false
 *                     properties:
 *                       user:
 *                         type: string
 *                       password:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [basic, digest]
 *                     required: [user, password, type]
 *             required: [id, sparqlURI]
 *         model:
 *           type: array
 *           items:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               id:
 *                 type: string
 *               types:
 *                 type: array
 *                 items:
 *                   type: object
 *                   additionalProperties: false
 *                   properties:
 *                     label:
 *                       type: string
 *                     endpoint:
 *                       type: string
 *                     inferred:
 *                       type: boolean
 *                     restrictions:
 *                       type: array
 *                       items:
 *                         type: string
 *                     targetId:
 *                       type: string
 *                     embed:
 *                       type: boolean
 *                     writeonly:
 *                       type: boolean
 *                   required: [label, endpoint]
 *               dprops:
 *                 type: array
 *                 items:
 *                   type: object
 *                   additionalProperties: false
 *                   properties:
 *                     label:
 *                       type: string
 *                     endpoint:
 *                       type: string
 *                     iri:
 *                       type: string
 *                       format: uri
 *                     restrictions:
 *                       type: array
 *                       items:
 *                         type: string
 *                     writeonly:
 *                       type: boolean
 *                   required: [label, endpoint, iri]
 *               oprops:
 *                 type: array
 *                 items:
 *                   type: object
 *                   additionalProperties: false
 *                   properties:
 *                     label:
 *                       type: string
 *                     endpoint:
 *                       type: string
 *                     iri:
 *                       type: string
 *                       format: uri
 *                     inv:
 *                       type: boolean
 *                     restrictions:
 *                       type: array
 *                       items:
 *                         type: string
 *                     targetId:
 *                       type: string
 *                     embed:
 *                       type: boolean
 *                     writeonly:
 *                       type: boolean
 *                   required: [label, endpoint, iri]
 *             required: [id, types, dprops, oprops]
 *         queryTemplates:
 *           type: array
 *           items:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               id:
 *                 type: string
 *               endpoint:
 *                 type: string
 *               description:
 *                 type: string
 *               template:
 *                 type: string
 *               variables:
 *                 type: array
 *                 items:
 *                   type: string
 *               parameters:
 *                 type: array
 *                 items:
 *                   type: object
 *                   additionalProperties: false
 *                   properties:
 *                     label:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [iri, string, number, integer, boolean]
 *                     optional:
 *                       type: boolean
 *                   required: [label, type]
 *             required: [id, endpoint, template, variables, parameters]
 *       required: [apiId, endpoints, model, queryTemplates]
 *
 *     ApiResponse:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         status:
 *           type: integer
 *           format: int32
 *         message:
 *           type: string
 *         location:
 *           type: string
 *         url:
 *           type: string
 *           format: uri
 *       required: [status, message]
 *
 *     DumpConfig:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         parameters:
 *           type: object
 *           additionalProperties:
 *             anyOf:
 *               - type: string
 *               - type: number
 *               - type: boolean
 *               - type: array
 *                 items:
 *                   anyOf:
 *                     - type: string
 *                     - type: number
 *                     - type: boolean
 *           description: Parameters to be used in a `step` or an `output` element
 *         steps:
 *           type: array
 *           items:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               id:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [resource, resources, query]
 *               parameters:
 *                 type: object
 *                 additionalProperties:
 *                   anyOf:
 *                     - type: string
 *                     - type: number
 *                     - type: boolean
 *                     - type: array
 *                       items:
 *                         anyOf:
 *                           - type: string
 *                           - type: number
 *                           - type: boolean
 *                     - $ref: '#/components/schemas/DumpConfigParameter'
 *                     - $ref: '#/components/schemas/DumpStepResult'
 *                 description: Check the API model and query templates to set valid parameters
 *             required: [id, type, parameters]
 *         output:
 *           type: array
 *           items: 
 *             type: object
 *             additionalProperties: false
 *             properties: 
 *               source:
 *                 type: string
 *                 enum: [parameters, steps]
 *               id:
 *                 type: string
 *                 description: The `id` corresponds to a previous step in the `DumpConfig` object
 *               key:
 *                 type: string
 *                 description: The `key` has to be defined in the `parameters` of the `DumpConfig` object
 *               label:
 *                  type: string
 *                  description: The label in the map to store this output item
 *             required: [source, label]
 *       required: [steps, output]
 * 
 *     DumpConfigParameter:
 *       type: object
 *       additionalProperties: false
 *       properties: 
 *         source:
 *           type: string
 *           enum: [parameters]
 *         key:
 *           type: string
 *       required: [source, key]
 *       description: The `key` has to be defined in the `parameters` of the `DumpConfig` object
 *
 *     DumpStepResult:
 *       type: object
 *       additionalProperties: false
 *       properties: 
 *         source: 
 *           type: string
 *           enum: [steps]
 *         id:
 *           type: string
 *         key:
 *           type: string
 *         variable:
 *           type: string
 *       required: [source, id]
 *       description: |
 *         The `id` corresponds to a previous step in the `DumpConfig` object.
 *         Steps of types `resource` or `resource` need a `key` to extract the values of the step results (check the corresponding model element of the API).
 *         Steps of type `query` need a `variable` to extract the values of the step results (check the corresponding query template of the API).
 * 
 *   securitySchemes:
 *     BasicAuth:
 *       type: http
 *       scheme: basic
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 */ 


// LECTURA DE USUARIOS DE FICHERO E INICIALIZACIÓN DE SUS APIs
async function init() {
	let existe = await util.checkFile(usersFilePath);
	if (existe) {
		logger.info('There is a users file');
		try {
			users = await util.loadFile(usersFilePath);
			logger.info('Users loaded');
			// una vez cargado el fichero de usuarios, inicializo las APIS
			for (let login in users) {
				const user = users[login];				
				for (let apiId in user.apis) {
					// si falla la inicialización de una API hacemos logging del error y vamos con la siguiente
					try {
						const path = dirApiPath + apiId + ".json";
						let confExiste = await util.checkFile(path);
						if (confExiste) {
							// cargo api del fichero
							let apiConfig = await util.loadFile(path);
							// analizo si la api cargada es correcta
							if (apiConfig.apiId != undefined && apiConfig.apiId === apiId) {			
								// etiqueta correcta... pido validación del modelo
								await modelValidator.validateAPIConfig(apiConfig, {quuid: 'init', apiId: apiId});
								// configuración validada => creo la API
								createAPI(apiId, apiConfig);
								// inicializo en el dumpManager
								await dumpManager.initApi(apiId);								
								// ha ido bien
								logger.info('The initialization of the API "' +apiId + '" has succeeded');							
							} else throw new Error("The configuration has a wrong apiId");
						} else throw new Error('No configuration file');	
					} catch(err) {	// no pudo configurarse la API... hacemos logging del error
						logger.error('The initialization of the API "' +apiId + '" has failed: ' + err.message);
					}				
				} // for user apis
			} // for users
			logger.info('The initialization of the APIs has finished');
			return;
		} catch(err) {
			logger.error('Error loading the users file: ' + err.message);
			// error no salvable...
			throw err;
		}
	} else {
		logger.warn('There is NO users file');
		try {
			// creo usuario root
			users.root = {
				login: 'root',
				password: config.root,
				email: config.rootEmail,
				created: new Date().toISOString(),
				apis: {}
			};			
			// guardo fichero usuarios
			await util.saveFile(usersFilePath, users);
			return;
		} catch(err) {
			logger.error('Error creating the users file: ' + err.message);
			// error no salvable...
			throw err;
		}
	}
}


function createAPI(apiId, apiConfig) {
	// inicializo la api
	apis[apiId] = {};
	// guardo la configuración de la API
	apis[apiId].config = apiConfig;
	// inicializo la caché de la API
	apis[apiId].cache = {};
	_.each(apis[apiId].config.model, (el) => {
		apis[apiId].cache[el.id] = {};	
	});
}


// SERVE INDEX FILE
async function getIndex(req, res, next) {	
	// sirvo el fichero index.html
	const indexpath = './index.html';
	res.type('html');
	fs.createReadStream(indexpath).pipe(res);
	return;
}


// FUNCIONES DE USUARIOS
function retrieveUser(login) {
	return users[login];
}
function retrieveApiOwner(apiId) {
	for (let login in users) {
		const user = users[login];
		for (let evapid in user.apis) {
			if (evapid === apiId)
				return login;
		}
	}
	return undefined; // si no hay coincidencia
}
function retrieveApiOwner(apiId) {
	for (let login in users) {
		const user = users[login];
		for (let evapid in user.apis) {
			if (evapid === apiId)
				return login;
		}
	}
	return undefined; // si no hay coincidencia
}
function validarTokenApi(token, apiId, escritura) {
	// obtengo owner de la api
	const owner = retrieveApiOwner(apiId);
	if (owner != undefined) {
		// comparo primero con el token de escritura (válido también para lectura)
		if (token === users[owner].apis[apiId].writeToken)
			return true;
		if (!escritura && token === users[owner].apis[apiId].readToken)
			return true;	
	}
	return false;
}


/** 
  * @swagger 
  * /users: 
  *   get: 
  *     summary: Get the list of CRAFTS users (requires root access)
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - user
  *     operationId: getUsers
  *     responses: 
  *       '200': 
  *         description: The list of users
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               additionalProperties:
  *                 $ref: '#/components/schemas/UserData'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */ 
async function getUsers(req, res, next) {
	// sólo acceso root
	if (req.login !== 'root') {
		objresp = {};
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;	
	}

	// devuelvo los usuarios
	res.type('json');
	res.send( users );
	return;
}

/** 
  * @swagger 
  * /users: 
  *   post: 
  *     summary: Create a CRAFTS user
  *     tags: 
  *       - user
  *     operationId: postUser
  *     requestBody:
  *       description: User info to create the user
  *       required: true
  *       content:
  *         application/json:
  *           schema: 
  *             $ref: '#/components/schemas/User'
  *     responses:
  *       '201': 
  *         description: User created
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid user
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */ 
async function postUser(req, res, next) {
	// extraigo la info de usuario (ya validado por openApiValidator)
	let userInfo = req.body;
		
	// pregenero objeto de respuesta
	let objresp = {};	
	
	// compruebo si ya existe el login 
	if (users[userInfo.login] != undefined) {
		objresp.status = 400;
		objresp.message = 'Login already exists';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
		
	// validación de longitud de login y password
	try {
		if (userInfo.login.length < 4)
			throw new Error("Login too short (min. 4 characters)");
		if (userInfo.login.length > 12)
			throw new Error("Login too long (max. 4 characters)");
		if (userInfo.password.length < 6)
			throw new Error("Password too short (min. 6 characters)");	
	} catch(err) {
		objresp.status = 400;
		objresp.message = err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;	
	}
	
	// completo datos de usuario
	userInfo.created = new Date().toISOString();
	userInfo.apis = {};
	userInfo.activationKey = uuidv4(); // pendiente activación por email
				
	// preparo la ruta y url para incluir en objresp
	const loc = config.prepath + '/' + config.userPath + '/' + userInfo.login;
	const url = config.scheme + '://' + config.authority + loc;	
	
	// mando correo de activación
	const link = url + '/' + userInfo.activationKey;
	const transporter = nodemailer.createTransport(config.smtpServer);
	const message = {
		from: '"CRAFTS" <' + config.smtpServer.auth.user + '>', // sender address
    	to: userInfo.email, // list of receivers
    	subject: "Activate your CRAFTS account", // Subject line
		//text: "Hello world?", // plain text body
		html: 'Welcome to this CRAFTS service. In order to activate your account, please click on <a href="' + link + '">this link</a>' // html body
	};
	try {
		await transporter.sendMail(message);
	} catch(err) {
		objresp.status = 500;
		objresp.message = 'User creation error: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
			
	// guardo usuario
	users[userInfo.login] = userInfo;
	// guardo fichero de usuarios
	try {
		await util.saveFile(usersFilePath, users);
	} catch(err) {
		objresp.status = 500;
		objresp.message = 'User creation error: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// respuesta
	objresp.status = 201;
	objresp.message = 'User created. We have sent you an email with the activation instructions';

	objresp.location = loc;
	objresp.url = url;
	
	// ajusto también localización en la respuesta
	res.location(loc);
	res.loc = loc;
	
	// logging usuario creado
	logger.info('User "' + userInfo.login + '" has been created');
	
	// devuelvo respuesta
	res.type('json');
	res.status(objresp.status).send(objresp);
	return;
}

/** 
  * @swagger 
  * /users/{login}/{actKey}: 
  *   get: 
  *     summary: Activate a CRAFTS user
  *     tags: 
  *       - user
  *     operationId: activateUser
  *     parameters:
  *       - name: login
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *       - name: actKey
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses:
  *       '200': 
  *         description: User activated
  *         content:
  *           application/json:  
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: User not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */ 
async function activateUser(req, res, next) {
	// extraigo login y actKey
	const login = req.params.login;
	const actKey = req.params.actKey;
	
	// inicializo objeto respuesta
	let objresp = {};
	
	// compruebo si existe el usuario
	if (users[login] == undefined) {
		// no existe...
		objresp.status = 404;
		objresp.message = 'User not found';
		res.errorMessage = objresp.message;
	} // compruebo si el usuario requiere activación
	else if (users[login].activationKey == undefined) {
		// ya activado...
		objresp.status = 400;
		objresp.message = 'Invalid request. User already activated';
		res.errorMessage = objresp.message;
	} // compruebo si la clave de activación está bien
	else if (users[login].activationKey !== actKey) {
		// clave no coincide...
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
	} else {
		// activación correcta
		delete users[login].activationKey;
		users[login].activated = new Date().toISOString();
		// guardo fichero de usuarios
		try {
			await util.saveFile(usersFilePath, users);
			// respuesta
			objresp.status = 200;
			objresp.message = 'User activated';
			// logging usuario activado
			logger.info('User "' + login + '" has been activated');
		} catch(err) {
			objresp.status = 500;
			objresp.message = 'User activation error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
		}
	}
	
	// devuelvo respuesta
	res.type('json');
	res.status(objresp.status).send(objresp);
	return;
}


/** 
  * @swagger 
  * /users/{login}: 
  *   get: 
  *     summary: Get a CRAFTS user
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - user
  *     operationId: getUser
  *     parameters:
  *       - name: login
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses:
  *       '200': 
  *         description: The user
  *         content:
  *           application/json:  
  *             schema: 
  *               $ref: '#/components/schemas/UserData'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: User not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function getUser(req, res, next) {
	// extraigo login
	const login = req.params.login;
	// inicializo objeto de respuesta
	let objresp = {};
	res.type('json');
	// compruebo si tiene permiso
	if (req.login !== 'root' && req.login !== login) {
		// sin permiso...
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
	} else if (users[login] == undefined) { // compruebo si existe el usuario
		// no existe...
		objresp.status = 404;
		objresp.message = 'User not found';
		res.errorMessage = objresp.message;
	} else { // existe, devuelvo los datos del usuario
		res.status(200).send(users[login]);
		return;
	}	
	res.status(objresp.status).send(objresp);
	return;
}


/** 
  * @swagger 
  * /users/{login}: 
  *   put: 
  *     summary: Update a CRAFTS user
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - user
  *     operationId: putUser
  *     parameters:
  *       - name: login
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     requestBody:
  *       description: User info to update the user
  *       required: true
  *       content:
  *         application/json:
  *           schema: 
  *             $ref: '#/components/schemas/User'
  *     responses:
  *       '200': 
  *         description: User updated
  *         content:
  *           application/json:  
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Bad request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: User not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function putUser(req, res, next) {	
	// extraigo login
	const login = req.params.login;
	// extraigo la info de usuario (ya validado por openApiValidator)
	let userInfo = req.body;
		
	// pregenero objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso
	if (req.login !== 'root' && req.login !== login) {
		// sin permiso...
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}

	// compruebo que ya exista el login 
	if (users[login] == undefined) {
		objresp.status = 404;
		objresp.message = 'User not found';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// compruebo que coincida el login 
	if (userInfo.login !== login) {
		objresp.status = 400;
		objresp.message = 'Bad request. The login in the path is not the same as the one in the body request';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// validación de longitud de password
	if (userInfo.password.length < 6) {
		objresp.status = 400;
		objresp.message = "Password too short (min. 6 characters)"
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;	
	}
	
	// petición correcta, actualizo datos
	users[login].password = userInfo.password;
	users[login].firstName = userInfo.firstName;
	users[login].lastName = userInfo.lastName;
	users[login].email = userInfo.email;

	// guardo fichero de usuarios
	try {
		await util.saveFile(usersFilePath, users);
	} catch(err) {
		objresp.status = 500;
		objresp.message = 'User update error: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);		
	}

	// logging usuario actualizado
	logger.info('User "' + login + '" has been updated');
	
	// respuesta
	objresp.status = 200;
	objresp.message = 'User updated';	
	// devuelvo respuesta
	res.type('json');
	res.status(objresp.status).send(objresp);
	return;
}



/** 
  * @swagger 
  * /users/{login}: 
  *   delete: 
  *     summary: Delete a CRAFTS user
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - user
  *     operationId: deleteUser
  *     parameters:
  *       - name: login
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses:
  *       '200': 
  *         description: User deleted
  *         content:
  *           application/json:  
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: User not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function deleteUser(req, res, next) {
	// extraigo login
	const login = req.params.login;
		
	// pregenero objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso
	if (login === 'root' || (req.login !== 'root' && req.login !== login) ) {
		// sin permiso...
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}

	// compruebo que ya exista el login 
	if (users[login] == undefined) {
		objresp.status = 404;
		objresp.message = 'User not found';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// petición válida
	try {
		// borro primero las APIs
		for (let apiId in users[login].apis) {
			// elimino toda la información de la API
			delete apis[apiId];			
			// elimino fichero con la configuración
			const path = dirApiPath + apiId + ".json";
			await util.deleteFile(path);						
			// pido al dumpManager que borre todo lo de dicha API
			await dumpManager.deleteApi(apiId);
			// mensaje para el log...
			logger.info('API "' + apiId + '" has been deleted');
		} 
	
		// borro el usuario
		delete users[login];
		// guardo fichero de usuarios
		await util.saveFile(usersFilePath, users);
	} catch(err) {
		objresp.status = 500;
		objresp.message = 'User deletion error: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;	
	}

	// logging usuario borrado
	logger.info('User "' + login + '" has been deleted');
		
	// respuesta
	objresp.status = 200;
	objresp.message = 'User deleted';	
	// devuelvo respuesta
	res.type('json');
	res.status(objresp.status).send(objresp);
	return;
}




// FUNCIONES PARA DEVOLVER EL LISTADO DE APIS Y CADA API (su configuración)

/** 
  * @swagger 
  * /apis: 
  *   get: 
  *     summary: Get the list of the configured APIs through CRAFTS
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - api
  *     operationId: listApis
  *     responses: 
  *       '200': 
  *         description: A list of API summaries
  *         content:
  *           application/json:
  *             schema: 
  *               type: array
  *               items:
  *                 $ref: '#/components/schemas/ApiSummary'
  *               example:
  *                 - apiId: educawood
  *                   url: https://forestexplorer.gsic.uva.es/crafts/apis/educawood
  *                 - apiId: simanfor
  *                   url: https://forestexplorer.gsic.uva.es/crafts/apis/simanfor
  *         links:
  *           GetApiByID:
  *             operationId: getApi
  *             parameters:
  *               apiId: '$response.body#/apiId'
  *             description: >
  *               The `apiId` value of an ApiSummary returned in the response can be used as
  *               the `apiId` parameter in `GET /apis/{apiId}`
  */ 
function getApis(req, res, next) {
	// devuelvo las apis registradas
	let salida = [];	
	for (let apiId in apis) {
		// para cada api registrada...
		let apires = {
			"apiId": apiId,
			"url": config.scheme + '://' + config.authority
				+ config.prepath + '/' + config.apisPath + '/' + apiId
		};
		salida.push(apires)
	}
	
	// devuelvo la lista
	res.type('json');
	res.send( salida );
	return;
}

/** 
  * @swagger 
  * /apis/{apiId}: 
  *   get: 
  *     summary: Get a configured API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - api
  *     operationId: getApi
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string 
  *     responses:
  *       '200': 
  *         description: A configuration of an API
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/Api'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */ 
async function getApi(req, res, next) {	
	// extraigo apiId
	const apiId = req.params.apiId;
	
	// si hay token hay que mirar si es válido
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, false);
		if (!valido) {
			// sin autorización
			let objresp = {};
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// compruebo si existe la api
	if (apis[apiId] == undefined) {
		// no existe...
		let objresp = {};
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// todo ok, devuelvo la configuración
	res.type('json');
	// sólo muestro info acceso endpoints si es el dueño de la API o root
	if (req.token != undefined || (req.login !== 'root' && retrieveApiOwner(apiId) !== req.login) ) {
		// hay que borrar authinfo en la respuesta...
		const eps = apis[apiId].config.endpoints; // guardo para luego
		apis[apiId].config.endpoints =[];
		// rehago info endpoints
		for (let i=0; i<eps.length; i++) {
			let ep = _.omit(eps[i], 'authInfo'); // clon sin authInfo			
			if (ep.sparqlUpdate != undefined)
				ep.sparqlUpdate = _.omit(ep.sparqlUpdate, 'authInfo'); // clon sin authInfo			
			apis[apiId].config.endpoints.push(ep);
		}
		// mando la api
		res.send( apis[apiId].config );
		// restauro la info de endpoints
		apis[apiId].config.endpoints = eps;	
	}
	else // devuelvo la API completa
		res.send( apis[apiId].config );
	return;
}


// FUNCIÓN PARA CREAR O ACTUALIZAR UNA API
/** 
  * @swagger 
  * /apis/{apiId}: 
  *   put: 
  *     summary: Update or create a configured API
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - api
  *     operationId: putApi
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     requestBody:
  *       description: The API configuration to create or update
  *       required: true
  *       content:
  *         application/json:
  *           schema: 
  *             $ref: '#/components/schemas/Api'
  *     responses:
  *       '200': 
  *         description: API updated
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '201': 
  *         description: API created
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid API configuration
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */ 
async function putApi(req, res, next) {
	// extraigo apiId
	const apiId = req.params.apiId;
	// extraigo la configuración (modelo validado a nivel grueso por openApiValidator)
	const apiconf = req.body;
		
	// pregenero objeto de respuesta
	let objresp = {};
	
	// obtengo owner de la API (undefined si no existe)
	const owner = retrieveApiOwner(apiId);
	
	// compruebo si tiene permiso para seguir
	if (req.login !== 'root' && owner != undefined && owner !== req.login) {
		// ni es root, ni la API está por definir, ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;		
	}	
	
	// analizo si la api cargada es correcta
	if (apiconf.apiId != undefined && apiconf.apiId === apiId) {
		// etiqueta correcta... pido validación del modelo
		try {
			await modelValidator.validateAPIConfig(apiconf, {quuid: req.quuid, apiId: apiId});
		} catch(err) {
			objresp.status = 400;
			objresp.message = 'Invalid API configuration: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;		
		}
	} else {
		objresp.status = 400;
		objresp.message = 'Invalid API configuration: the configuration has a wrong apiId';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// guardamos la configuración en un fichero
	try {
		const path = dirApiPath + apiId + ".json";
		await util.saveFile(path, apiconf);		
	} catch(err) {
		// error en el guardado
		objresp.status = 500;
		objresp.message = 'API creation error: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}

	// opción por defecto es una actualización
	objresp.status = 200;
	objresp.message = 'API "' + apiId + '" has been updated';
	
	// si es una api nueva...
	if (apis[apiId] == undefined) {
		objresp.status = 201;
		objresp.message = 'API "' + apiId + '" has been created';
		
		// guardo referencia a la api con su dueño y genero tokens de acceso
		users[req.login].apis[apiId] = {
			created: new Date().toISOString(),
			readToken: uuidv4(), 
			writeToken:	uuidv4()
		};
		// hay que guardar fichero de usuarios y pedir inicialización al dumpManager
		try {
			// guardo el fichero de usuarios
			await util.saveFile(usersFilePath, users);
			// inicialización en el dumpManager
			await dumpManager.initApi(apiId);			
		} catch(err) {
			// error en el guardado de la lista
			objresp.status = 500;
			objresp.message = 'API creation error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// configuración validada => creo la API (y piso lo que había si es una actualización)
	createAPI(apiId, apiconf);
	logger.info(objresp.message);
		
	// preparo la ruta y url para incluir en objresp
	const loc = config.prepath + '/' + config.apisPath + '/' + apiId;
	const url = config.scheme + '://' + config.authority + loc;
	objresp.location = loc;
	objresp.url = url;
	
	// ajusto también localización en la respuesta
	res.location(loc); 
	res.loc = loc;
	
	// devuelvo respuesta
	res.type('json');
	res.status(objresp.status).send(objresp);
	return;
}


/** 
  * @swagger 
  * /apis/{apiId}/tokens: 
  *   post: 
  *     summary: Regenerate the access tokens of a CRAFTS API
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - api
  *     operationId: regenerateTokens
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses:
  *       '200': 
  *         description: API tokens regenerated
  *         content:
  *           application/json:  
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function regenerateTokens(req, res, next) {
	// extraigo apiId
	const apiId = req.params.apiId;
	
	// pregenero objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso
	const owner = retrieveApiOwner(apiId);
	if (req.login !== 'root' && owner != undefined && owner !== req.login) {
		// ni es root, ni la API está por definir, ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
	} else if (apis[apiId] == undefined) { // // compruebo si existe la api
		// no existe...
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
	} else { // existe la API
		// actualizo tokens
		users[owner].apis[apiId].readToken = uuidv4();
		users[owner].apis[apiId].writeToken = uuidv4();	
		try {
			// guardo fichero de usuarios
			await util.saveFile(usersFilePath, users);
			// logging tokens regenerados
			logger.info('Access tokens of API "' + apiId + '" has been regenerated');	
			// respuesta OK
			objresp.status = 200;
			objresp.message = 'API tokens regenerated';	
		} catch(err) {
			objresp.status = 500;
			objresp.message = 'Regenerate API tokens error: ' + err.message;
			res.errorMessage = objresp.message;	
		}
	}	
	// devuelvo respuesta (común a todos los casos)
	res.type('json');
	res.status(objresp.status).send(objresp);
	return;
}


/** 
  * @swagger 
  * /apis/{apiId}: 
  *   delete: 
  *     summary: Delete a configured API
  *     security:
  *       - BasicAuth: []
  *     tags: 
  *       - api
  *     operationId: deleteApi
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string  
  *     responses:
  *       '200': 
  *         description: API deleted
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */ 
async function deleteApi(req, res, next) {
	// extraigo apiId
	const apiId = req.params.apiId;
	
	// inicializo objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso
	const owner = retrieveApiOwner(apiId);
	if (req.login !== 'root' && owner != undefined && owner !== req.login) {
		// ni es root, ni la API está por definir, ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;		
	}
	
	// compruebo si existe la api
	if (apis[apiId] == undefined) {
		// no existe...
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
	} else { // existe, borro la API
		try {
			// elimino toda la información de la API
			delete apis[apiId];
			
			// elimino fichero con la configuración
			const path = dirApiPath + apiId + ".json";
			await util.deleteFile(path);		
						
			// pido al dumpManager que borre todo lo de dicha API
			await dumpManager.deleteApi(apiId);
			
			// borro API de los usuarios y actualizo fichero usuarios			
			if (owner != undefined) {
				delete users[owner].apis[apiId];
				await util.saveFile(usersFilePath, users);
			}
			
			// el borrado ha ido bien, devuelvo resultado
			objresp.status = 200;
			objresp.message = 'API "' + apiId + '" has been deleted';
			// mensaje para el log...
			logger.info(objresp.message);
			
			res.type('json');
			res.send( objresp );
		} catch(err) {
			objresp.status = 500;
			objresp.message = 'API deletion error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);		
		}
	}
	return;
}



// FUNCIONES PARA DEVOLVER REPRESENTACIONES DE LOS RECURSOS SOLICITADOS
/** 
  * @swagger 
  * /apis/{apiId}/resource: 
  *   get: 
  *     summary: Get the data about a resource from a configured API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - resource
  *     operationId: getResource
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of the API
  *       - name: id
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of a model element defined in the API
  *       - name: iri
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *           format: uri
  *         allowReserved: true # para que no se queje el validador
  *         description: The IRI of the resource
  *     responses:
  *       '200': 
  *         description: The data about a resource
  *         content:
  *           application/json:
  *             schema: 
  *               type: object
  *               description: The object schema is defined in the corresponding model element of the API  
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function getResource(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const id = req.query.id;
	const iri = req.query.iri;
	
	// pregenero objeto de respuesta
	let objresp = {};	
	
	// si hay token hay que mirar si es válido para lectura
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, false);
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	} 
	
	// compruebo que exista el id correspondiente en el modelo de la configuración	
	const mel = _.find(apis[apiId].config.model, (el) => el.id === id);
	if (mel != undefined) {
		// compruebo que la iri esté bien formada
		try {
			// lanza una excepción si iri no está bien formada: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
			new URL(iri); 
		} catch(error) {
			objresp.status = 400;
			objresp.message = 'Invalid request: the "iri" is not well-formatted. ' + error.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
		
		// petición correcta, preparo objeto con la petición
		let obj = {};
		obj.api = apis[apiId]; // meto la API completa
		obj.id = id;
		obj.iris = [];
		obj.iris.push(iri);
		
		try {
			// recupero datos
			let datos = await dataManager.getData(obj, {quuid: req.quuid, apiId: apiId});
			// incorporo consultas para el log
			res.numberOfQueries = datos.numberOfQueries;
			res.allQueries = datos.allQueries;			
			// si hay salida la devuelvo
			if (datos.data != undefined && datos.data.length == 1) {
				res.type('json');
				res.send( datos.data[0] );
				return;
			}	
		} catch(err) {
			// si no hacemos más comprobaciones de la petición habrá que asumir que el error es del servidor
			objresp.status = 500;
			objresp.message = 'Extraction error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else {
		// mel no encontrado => id incorrecto
		objresp.status = 400;
		objresp.message = 'Invalid request: the "id" does not exist in the API model';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// si llega aquí la petición es incorrecta (no debería llegar nunca)
	objresp.status = 400;
	objresp.message = 'Invalid request: include the "id" of an existing model element and the "iri" of the resource to retrieve';
	res.errorMessage = objresp.message;
	res.status(objresp.status).send(objresp);
	return;	
}


/** 
  * @swagger 
  * /apis/{apiId}/resources: 
  *   get: 
  *     summary: Get the data about a set of resources from a configured API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - resource
  *     operationId: getResources
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of the API
  *       - name: id
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of a model element defined in the API
  *       - name: iris
  *         in: query
  *         required: true
  *         schema:
  *           type: array
  *           items:
  *             type: string
  *         allowReserved: true # para que no se queje el validador
  *         description: The IRIs of the resources (can be abbreviated if `nspref` is used)
  *       - name: ns
  *         in: query
  *         required: false
  *         schema:
  *           type: string
  *           format: uri
  *         allowReserved: true # para que no se queje el validador
  *         description: The namespace IRI of the prefix `nspref`
  *       - name: nspref
  *         in: query
  *         required: false
  *         schema:
  *           type: string
  *         description: The label of the prefix (can be used to abbreviate `iris`)
  *     responses:
  *       '200': 
  *         description: The data about the set of resources
  *         content:
  *           application/json:
  *             schema: 
  *               type: array
  *               items:
  *                 type: object
  *                 description: The object schema is defined in the corresponding model element of the API  
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function getResources(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const id = req.query.id;
	let iris = req.query.iris;
	
	// pregenero objeto de respuesta
	let objresp = {};
	
	// si hay token hay que mirar si es válido para lectura
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, false);
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
		
	// TODO: ¿cortar la petición si son muchas IRIs?

	// compruebo que exista el id correspondiente en el modelo de la configuración	
	let mel = _.find(apis[apiId].config.model, (el) => el.id === id);
	if (mel != undefined) {
		// el tipo es correcto, miro si hay namespace
		const ns = req.query.ns;
		const nspref = req.query.nspref;
		if (ns != undefined && nspref != undefined) {
			// hago las sustituciones que hagan falta
			const nsprefplus = nspref + ':';
			for (let i=0; i<iris.length; i++) {
				if (iris[i].startsWith( nsprefplus ))
					iris[i] = iris[i].replace( nsprefplus, ns );
			}
		}
		
		// compruebo que las iris estén bien formadas
		try {
			for (let i=0; i<iris.length; i++) {
				// lanza una excepción si iri no está bien formada: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
				new URL(iris[i]);
			}
		} catch(error) {
			objresp.status = 400;
			objresp.message = 'Invalid request: some of the "iris" are not well-formatted. ' + error.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}			
		
		// petición correcta, preparo objeto con la petición
		let obj = {};
		obj.api = apis[apiId]; // meto la API completa
		obj.id = id;
		obj.iris = iris;	

		try {
			// recupero datos
			let datos = await dataManager.getData(obj, {quuid: req.quuid, apiId: apiId});
			// incorporo consultas para el log
			res.numberOfQueries = datos.numberOfQueries;
			res.allQueries = datos.allQueries;			
			// si hay salida la devuelvo
			if (datos.data != undefined) {
				res.type('json');
				res.send( datos.data );
				return;
			}	
		} catch(err) {
			// si no hacemos más comprobaciones de la petición habrá que asumir que el error es del servidor
			objresp.status = 500;
			objresp.message = 'Extraction error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else {
		// mel no encontrado => id incorrecto
		objresp.status = 400;
		objresp.message = 'Invalid request: the "id" does not exist in the API model';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// si llega aquí la petición es incorrecta (no debería llegar nunca)
	objresp.status = 400;
	objresp.message = 'Invalid request: include the "id" of an existing model element, a list of "iris" of the resource to retrieve, and optionally a namespace "ns" with prefix "nspref"';
	res.errorMessage = objresp.message;
	res.status(objresp.status).send(objresp);
	return;	
}


// FUNCIÓN PARA CREAR O REEMPLAZAR UN RECURSO
/** 
  * @swagger 
  * /apis/{apiId}/resource: 
  *   put: 
  *     summary: Create or replace a resource from a configured API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - resource
  *     operationId: putResource
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of the API
  *       - name: id
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of a model element defined in the API
  *       - name: iri
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *           format: uri
  *         allowReserved: true # para que no se queje el validador
  *         description: The IRI of the resource
  *     requestBody:
  *       description: The data about the resource
  *       required: true
  *       content:
  *         application/json:
  *           schema: 
  *             type: object
  *             description: The object schema is defined in the corresponding model element of the API
  *     responses:
  *       '200': 
  *         description: Resource replaced
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '201': 
  *         description: Resource created
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function putResource(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const id = req.query.id;
	const iri = req.query.iri;
	
	// pregenero objeto de respuesta
	let objresp = {};
		
	// compruebo si tiene permiso (si hay token hay que mirar si es válido)
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, true); // hace falta token de escritura
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else if (req.login !== 'root' && retrieveApiOwner(apiId) !== req.login) {
		// ni es root ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	} 
	
	// compruebo que exista el id correspondiente en el modelo de la configuración	
	const mel = _.find(apis[apiId].config.model, (el) => el.id === id);
	if (mel != undefined) {		
		// obtengo el objeto del body y lo valido
		const objr = req.body;		
		try {
			modelValidator.validateResource(iri, objr, mel, apis[apiId].config, "root");
		} catch(error) {
			objresp.status = 400;
			objresp.message = 'Invalid request: ' + error.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
		
		// ha pasado el validador, la actualización debería poder hacerse		
		try {
			// pido la actualización
			let datos = await resourceUpdater.putResource(iri, objr, mel, apis[apiId], {quuid: req.quuid, apiId: apiId});
			// meto info de las triplas borradas/creadas y consultas
			res.numberOfQueries = datos.numberOfQueries;
			res.deletedTriples = datos.deletedTriples;
			res.insertedTriples = datos.insertedTriples;			
			// preparo la ruta y url para incluir en objresp
			const loc = req.url;
			const url = config.scheme + '://' + config.authority + loc;
			objresp.location = loc;
			objresp.url = url;	
			// ajusto también localización en la respuesta
			res.location(loc); 
			res.loc = loc;
			// pongo status, message y mando						
			if (datos.deletedTriples == 0) {
				objresp.status = 201;
				objresp.message = 'Resource created. #queries: ' + datos.numberOfQueries 
					+ '. #inserted triples: ' + datos.insertedTriples;
			}
			else {
				objresp.status = 200;
				objresp.message = 'Resource replaced. #queries: ' + datos.numberOfQueries 
					+ '. #deleted triples: ' + datos.deletedTriples 
					+ '. #inserted triples: ' + datos.insertedTriples;
			}			
			res.status(objresp.status).send(objresp);
			// 02-02-2021 vacío también la caché de consultas por si acaso
			dataManager.cleanCachedQueries(new Date().getTime());
			return;			
		} catch(err) {
			// si no hacemos más comprobaciones de la petición habrá que asumir que el error es del servidor
			objresp.status = 500;
			objresp.message = 'Resource create or replace error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else {
		// mel no encontrado => id incorrecto
		objresp.status = 400;
		objresp.message = 'Invalid request: the "id" does not exist in the API model';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// si llega aquí la petición es incorrecta (no debería llegar nunca)
	objresp.status = 400;
	objresp.message = 'Invalid request: include the "id" of an existing model element, the "iri" of the resource to update or create, and the resource data in the body request';
	res.errorMessage = objresp.message;
	res.status(objresp.status).send(objresp);
	return;	
}



// FUNCIÓN PARA ACTUALIZAR UN RECURSO
/** 
  * @swagger 
  * /apis/{apiId}/resource: 
  *   patch: 
  *     summary: Update a resource from a configured API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - resource
  *     operationId: patchResource
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of the API
  *       - name: id
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of a model element defined in the API
  *       - name: iri
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *           format: uri
  *         allowReserved: true # para que no se queje el validador
  *         description: The IRI of the resource
  *     requestBody:
  *       description: The data about the resource to be patched
  *       required: true
  *       content:
  *         application/json:
  *           schema: 
  *             type: array
  *             items:
  *               type: object
  *               additionalProperties: false
  *               properties:
  *                 op:
  *                   type: string
  *                   enum: [add, remove, replace]
  *                 path:
  *                   type: string
  *                   description: A JSON-Pointer value (RFC 6901)
  *                 value:
  *                   description: Required in add and replace operations
  *               required: [op, path]
  *             description: JSON Patch notation is used (RFC 6902). Supported operations are "add", "remove", "replace"
  *     responses:
  *       '200': 
  *         description: Resource updated
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function patchResource(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const id = req.query.id;
	const iri = req.query.iri;
	
	// pregenero objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso (si hay token hay que mirar si es válido)
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, true); // hace falta token de escritura
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else if (req.login !== 'root' && retrieveApiOwner(apiId) !== req.login) {
		// ni es root ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	} 
	
	// compruebo que exista el id correspondiente en el modelo de la configuración	
	const mel = _.find(apis[apiId].config.model, (el) => el.id === id);
	if (mel != undefined) {
		// compruebo que la iri esté bien formada
		try {
			// lanza una excepción si iri no está bien formada: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
			new URL(iri); 
		} catch(error) {
			objresp.status = 400;
			objresp.message = 'Invalid request: the "iri" is not well-formatted. ' + error.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
		
		// obtengo el patch del body
		const patch = req.body;		
		try {
			// pido la validación del patch
			modelValidator.validatePatch(patch, mel, apis[apiId].config);
		} catch(error) {
			objresp.status = 400;
			objresp.message = 'Invalid request: ' + error.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
				
		// ha pasado el validador, la actualización debería poder hacerse		
		try {
			// pido la actualización (puede fallar dependiendo de los valores de la representación)
			let datos = await resourceUpdater.patchResource(iri, patch, mel, apis[apiId], {quuid: req.quuid, apiId: apiId});
			// meto info de las triplas borradas/creadas y consultas
			res.numberOfQueries = datos.numberOfQueries;
			res.deletedTriples = datos.deletedTriples;
			res.insertedTriples = datos.insertedTriples;
			// pongo status, message y mando
			objresp.status = 200;
			objresp.message = 'Resource updated. #queries: ' + datos.numberOfQueries 
				+ '. #deleted triples: ' + datos.deletedTriples 
				+ '. #inserted triples: ' + datos.insertedTriples;
			res.status(objresp.status).send(objresp);
			// 02-02-2021 vacío también la caché de consultas por si acaso
			dataManager.cleanCachedQueries(new Date().getTime());
			return;
		} catch(err) {
			// cojo el status del error incluido, si no hay habrá que asumir que el error es del servidor
			objresp.status = err.status || 500;
			objresp.message = 'Resource update error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else {
		// mel no encontrado => id incorrecto
		objresp.status = 400;
		objresp.message = 'Invalid request: the "id" does not exist in the API model';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// si llega aquí la petición es incorrecta (no debería llegar nunca)
	objresp.status = 400;
	objresp.message = 'Invalid request: include the "id" of an existing model element, the "iri" of the resource to update or create, and the resource data in the body request';
	res.errorMessage = objresp.message;
	res.status(objresp.status).send(objresp);
	return;	
}




// FUNCIÓN PARA BORRAR UN RECURSO
/** 
  * @swagger 
  * /apis/{apiId}/resource: 
  *   delete: 
  *     summary: Delete a resource from a configured API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - resource
  *     operationId: deleteResource
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of the API
  *       - name: id
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of a model element defined in the API
  *       - name: iri
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *           format: uri
  *         allowReserved: true # para que no se queje el validador
  *         description: The IRI of the resource
  *     responses:
  *       '200': 
  *         description: Resource deleted
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: Resource not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function deleteResource(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const id = req.query.id;
	const iri = req.query.iri;
	
	// pregenero objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso (si hay token hay que mirar si es válido)
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, true); // hace falta token de escritura
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else if (req.login !== 'root' && retrieveApiOwner(apiId) !== req.login) {
		// ni es root ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	} 
	
	// compruebo que exista el id correspondiente en el modelo de la configuración	
	const mel = _.find(apis[apiId].config.model, (el) => el.id === id);
	if (mel != undefined) {
		// compruebo que la iri esté bien formada
		try {
			// lanza una excepción si iri no está bien formada: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
			new URL(iri); 
		} catch(error) {
			objresp.status = 400;
			objresp.message = 'Invalid request: the "iri" is not well-formatted. ' + error.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
		
		// pido el borrado
		try {
			let datos = await resourceUpdater.deleteResource(iri, mel, apis[apiId], {quuid: req.quuid, apiId: apiId});
			res.numberOfQueries = datos.numberOfQueries;
			res.deletedTriples = datos.deletedTriples;
			objresp.status = 200;
			objresp.message = 'Resource deleted. #queries: ' + datos.numberOfQueries 
				+ '. #deleted triples: ' + datos.deletedTriples;
			res.status(objresp.status).send(objresp);
			// 02-02-2021 vacío también la caché de consultas por si acaso
			dataManager.cleanCachedQueries(new Date().getTime());
			return;			
		} catch(err) {
			// si no hacemos más comprobaciones de la petición habrá que asumir que el error es del servidor
			objresp.status = 500;
			objresp.message = 'Resource delete error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else {
		// mel no encontrado => id incorrecto
		objresp.status = 400;
		objresp.message = 'Invalid request: the "id" does not exist in the API model';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// si llega aquí la petición es incorrecta (no debería llegar nunca)
	objresp.status = 400;
	objresp.message = 'Invalid request: include the "id" of an existing model element and the "iri" of the resource to delete';
	res.errorMessage = objresp.message;
	res.status(objresp.status).send(objresp);
	return;	
}



// FUNCIÓN PARA RESPONDER A UNA CONSULTA
/** 
  * @swagger 
  * /apis/{apiId}/query: 
  *   get: 
  *     summary: Send a parametrized query as configured in an API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     description: |
  *       This operation needs to reference a valid query template (parameter `id`) in the API. 
  *       Note that a query template may define parameters (and some MAY BE REQUIRED). These parameters 
  *       can be provided as query parameters in the URL
  *     tags: 
  *       - query
  *     operationId: answerQuery
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of the API
  *       - name: id
  *         in: query
  *         required: true
  *         schema:
  *           type: string
  *         description: The id of a query template element defined in the API
  *     responses:
  *       '200': 
  *         description: The answer to the submitted parametrized query
  *         content:
  *           application/json:
  *             schema: 
  *               type: object  
  *               additionalProperties: false
  *               properties:
  *                 head:
  *                   type: object
  *                 results:
  *                   type: object
  *                 query:
  *                   type: string  
  *               required: [head, results, query]
  *               description: |
  *                 The query results, as defined in https://www.w3.org/TR/rdf-sparql-json-res/
  *                 The executed query is included in the returned object
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function answerQuery(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const id = req.query.id;
		
	// pregenero objeto de respuesta
	let objresp = {};
	
	// si hay token hay que mirar si es válido para lectura
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, false);
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	} 
	
	// recupero la plantilla de la consulta
	let qtemp = _.find(apis[apiId].config.queryTemplates, (el) => el.id === id);
	if (qtemp != undefined) {	
		// preparo objeto auxiliar para la consulta
		let aux = {};
		// meto cada parámetro en el objeto auxiliar
		for (let i=0; i<qtemp.parameters.length; i++) {				
			const par = qtemp.parameters[i];
			// si existe el parámetro en la petición...
			if (req.query[par.label] != undefined)
				aux[par.label] = req.query[par.label];
		}
		// valido parámetros de la consulta (y hago conversiones de parámetros si hace falta)
		try {
			modelValidator.validateQuery(qtemp, aux);
		} catch(err) {
			objresp.status = 400;
			objresp.message = 'Invalid request: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
		
		// obtengo endpoint
		const endpoint = _.find(apis[apiId].config.endpoints, el => el.id === qtemp.endpoint);
		// obtengo prefijos
		//const prefixes = apis[apiId].config.prefixes;
		try {
			// obtengo resultados de la consulta
			let datos = await dataManager.answerQuery(endpoint, qtemp, aux, {quuid: req.quuid, apiId: apiId});
			//let datos = await dataManager.answerQuery(endpoint, qtemp, aux, req.quuid, prefixes);
		
			// si hay salida la devuelvo
			if (datos != undefined) {
				res.type('json');
				res.send( datos );
				return;
			}
		} catch(err) {
			// la plantilla se validó en la configuración, si hay fallo asumimos que el error es del servidor
			objresp.status = 500;
			objresp.message = 'Query error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else {
		// qtemp no encontrado => id incorrecto
		objresp.status = 400;
		objresp.message = 'Invalid request: the "id" does not exist in the API queryTemplates';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// si llega aquí la petición es incorrecta	
	objresp.status = 400;
	objresp.message = 'Invalid request: include the "id" of an existing query template with the required "parameters"';
	res.errorMessage = objresp.message;
	res.status(objresp.status).send(objresp);
	return;	
}


// FUNCIONES DE LOS DUMPS

/** 
  * @swagger 
  * /apis/{apiId}/dumps: 
  *   get: 
  *     summary: Get the list of dumps of a CRAFTS API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - dump
  *     operationId: listDumps
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses: 
  *       '200': 
  *         description: A list of dump summaries
  *         content:
  *           application/json:
  *             schema: 
  *               type: array
  *               items:
  *                 type: object
  *                 additionalProperties: false
  *                 properties:
  *                   id:
  *                     type: string
  *                   location:
  *                     type: string
  *                     format: uri
  *                   path:
  *                     type: string
  *                   status:
  *                     type: string
  *                     enum: [scheduled, started, finished, failed]
  *                   config:
  *                     $ref: '#/components/schemas/DumpConfig'
  *                   started:
  *                     type: string
  *                     format: date-time
  *                   ended:
  *                     type: string
  *                     format: date-time
  *                 required: [id, location, path, status, config]
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function getListOfDumps(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	
	// pregenero objeto de respuesta
	let objresp = {};
	
	// si hay token hay que mirar si es válido para lectura
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, false);
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// pido el path de la lista de dumps al dumpManager y la devuelvo
	let ldpath = await dumpManager.getListOfDumpsPath(apiId);
	if (ldpath == null) {
		// no existe la lista de dumps (debería estar creada si se inicializó la API...)
		objresp.status = 500;
		objresp.message = 'The initialization of the dumps of the API failed';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	else { // mando el fichero como un stream
		res.type('json');
		fs.createReadStream(ldpath).pipe(res);
		return;
	}
}


/** 
  * @swagger 
  * /apis/{apiId}/dumps/{dumpId}: 
  *   get: 
  *     summary: Get a dump of a CRAFTS API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - dump
  *     operationId: getDump
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *       - name: dumpId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses: 
  *       '200': 
  *         description: A dump
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               additionalProperties: false
  *               properties:
  *                 id:
  *                   type: string
  *                 location:
  *                   type: string
  *                   format: uri
  *                 path:
  *                   type: string
  *                 status:
  *                   type: string
  *                   enum: [scheduled, started, finished, failed]
  *                 config:
  *                   $ref: '#/components/schemas/DumpConfig'
  *                 started:
  *                   type: string
  *                   format: date-time
  *                 ended:
  *                   type: string
  *                   format: date-time
  *                 output:
  *                   type: object
  *                   additionalProperties:
  *                     type: array
  *                     items: {}
  *                   description: The output of the dump, as defined in the DumpConfig  
  *               required: [id, location, path, status, config]
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: Not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function getDump(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const dumpId = req.params.dumpId;
	
	// pregenero objeto de respuesta
	let objresp = {};	
	
	// si hay token hay que mirar si es válido para lectura
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, false);
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// pido el path del dump 
	let dumpPath = await dumpManager.getDumpPath(apiId, dumpId);
	if (dumpPath == null) {
		objresp.status = 404;
		objresp.message = 'Dump not found: ' + dumpId;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	else { // mando el fichero como un stream
		res.type('json');
		fs.createReadStream(dumpPath).pipe(res);
		return;		
	}
}



/** 
  * @swagger 
  * /apis/{apiId}/dumps:
  *   post: 
  *     summary: Create a dump of a CRAFTS API with config data
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - dump
  *     operationId: createDump
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     requestBody:
  *       description: The dump configuration
  *       required: true
  *       content:
  *         application/json:
  *           schema: 
  *             $ref: '#/components/schemas/DumpConfig'  
  *     responses: 
  *       '202': 
  *         description: Dump creation request accepted
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ApiResponse'
  *       '400': 
  *         description: Invalid request
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'  
  *       '404': 
  *         description: API not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function createDump(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	
	// pregenero objeto de respuesta
	let objresp = {};
	
	// compruebo si tiene permiso (si hay token hay que mirar si es válido)
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, true); // hace falta token de escritura
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else if (req.login !== 'root' && retrieveApiOwner(apiId) !== req.login) {
		// ni es root ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}

	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// extraigo la configuración del dump del cuerpo del post
	const dc = req.body;
	
	// pido validación de la configuración del dump
	try {
		modelValidator.validateDumpConfig(dc, apis[apiId].config);
	} catch(err) {
		objresp.status = 400;
		objresp.message = 'Invalid Dump configuration: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;		
	}
		
	// la petición parece correcta, paso la pelota al dumpManager
	try {
		// pido obtener el dump
		const urlini = config.scheme + '://' + config.authority;
		let loc = await dumpManager.createDump(apis[apiId], dc, {quuid: req.quuid, apiId: apiId});
		
		// devuelvo 202 (petición aceptada) y la respuesta del dumpManager con la localización
		res.location(loc); // ajusto localización en la respuesta
		res.loc = loc;
		objresp.status = 202;
		objresp.location = loc;
		objresp.url = urlini + loc;
		objresp.message = 'Dump creation request accepted';
		res.status(objresp.status).send(objresp);
		return;			
	} catch(err) {
		// si no hacemos más comprobaciones de la configuración del dump habrá que asumir que el error es del servidor
		objresp.status = 500;
		objresp.message = 'Dump creation error: ' + err.message;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
}



/** 
  * @swagger 
  * /apis/{apiId}/dumps/{dumpId}: 
  *   delete: 
  *     summary: Delete a dump of a CRAFTS API
  *     security:
  *       - BasicAuth: []
  *       - BearerAuth: []
  *     tags: 
  *       - dump
  *     operationId: deleteDump
  *     parameters:
  *       - name: apiId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *       - name: dumpId
  *         in: path
  *         required: true
  *         schema:
  *           type: string
  *     responses: 
  *       '200': 
  *         description: Dump deleted
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '401': 
  *         description: Unauthorized
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '403': 
  *         description: Forbidden
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  *       '404': 
  *         description: Dump not found
  *         content:
  *           application/json:
  *             schema: 
  *               $ref: '#/components/schemas/ApiResponse'
  */
async function deleteDump(req, res, next) {
	// extraigo parámetros de la URL
	const apiId = req.params.apiId;
	const dumpId = req.params.dumpId;
	
	// pregenero objeto de respuesta
	let objresp = {};	
	
	// si hay token hay que mirar si es válido para escritura
	if (req.token != undefined) {
		const valido = validarTokenApi(req.token, apiId, true); // hace falta token de escritura
		if (!valido) {
			// sin autorización
			objresp.status = 401;
			objresp.message = 'Unauthorized. Your token is not valid';
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);
			return;
		}
	} else if (req.login !== 'root' && retrieveApiOwner(apiId) !== req.login) {
		// ni es root ni es el dueño de la API
		objresp.status = 403;
		objresp.message = 'Forbidden';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// compruebo que la api exista
	if (apis[apiId] == undefined) {
		// no existe la api
		objresp.status = 404;
		objresp.message = 'API not found: "' + apiId + '" is not registered';
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
		return;
	}
	
	// pido el path del dump 
	let dumpPath = await dumpManager.getDumpPath(apiId, dumpId);
	if (dumpPath == null) {
		objresp.status = 404;
		objresp.message = 'Dump not found: ' + dumpId;
		res.errorMessage = objresp.message;
		res.status(objresp.status).send(objresp);
	}
	else { // existe, paso la pelota al dumpmanager
		try {
			await dumpManager.deleteDump(apiId, dumpId);
			// el borrado ha ido bien, devuelvo resultado
			objresp.status = 200;
			objresp.message = 'Dump "' + dumpId + '" of API "' + apiId + '" has been deleted';		
			res.type('json');
			res.send( objresp );
		} catch(err) {
			objresp.status = 500;
			objresp.message = 'Dump deletion error: ' + err.message;
			res.errorMessage = objresp.message;
			res.status(objresp.status).send(objresp);		
		}
	}
	return;
}



// FUNCIÓN PARA LIMPIAR LOS RECURSOS ANTIGUOS DE LA CACHÉ
function cleanCache() {
	// inicializo logmess
	let logmess = {};
	logmess.info = 'Cache cleaned';	
	logmess.started = new Date().toISOString();
	logmess.resourcesCached = {};
	
	// obtengo timestamp límite para borrar de la caché
	const timeNow = new Date().getTime();
	//const timeThreshold = timeNow - 120000; // 2 minutos!!!
	const timeThreshold = timeNow - 24*60*60*1000*config.daysCache; // timestamp límite

	// analizo la caché de cada api
	for (let apiId in apis) {
		// inicializo
		logmess.resourcesCached[apiId] = {
			inspected: 0,
			cleaned: 0		
		};
		for (let mel in apis[apiId].cache) {
			// iris de mel a borrar
			let irisBorrar = [];			
			for (let iri in apis[apiId].cache[mel]) {
				logmess.resourcesCached[apiId].inspected++; // un recurso más inspeccionado...
				if (apis[apiId].cache[mel][iri].timestampCache < timeThreshold)
					irisBorrar.push(iri); // incluyo en la lista de borrrados
			}
			// actualizo borrados
			logmess.resourcesCached[apiId].cleaned += irisBorrar.length;
			// y los borro de la caché
			for (let i=0; i<irisBorrar.length; i++)
				delete apis[apiId].cache[mel][irisBorrar[i]];
		}
	}
	
	// pido también la limpieza de las consultas cacheadas
	logmess.queriesCached = dataManager.cleanCachedQueries(timeThreshold);	
	
	// hago el log
	logmess.ended = new Date().toISOString();
	logger.info(logmess)
}



module.exports = {
	init,
	
	getIndex,
	
	retrieveUser,	
	getUsers,
	getUser,
	postUser,
	activateUser,
	putUser,
	deleteUser,

	getApis,
	getApi,
	putApi,
	regenerateTokens,
	deleteApi,
	
	getResource,
	getResources,
	putResource,
	patchResource,
	deleteResource,
	
	answerQuery,
		
	getListOfDumps,
	getDump,
	createDump,
	deleteDump,
	
	cleanCache
}