const config = require('../data/config');
const pLimit = require('p-limit').default;
const DigestClient = require('digest-fetch').default;
const mustache = require('mustache');
const logger = require('./logger'); // para el logging

// sept-26: pongo límites a la concurrencia por api-endpoint
const limits = new Map();

// extracción concurrencia
function getConc(endpoint) {
	const { min, max, defaultValue } = config.defaultOptions.endpoints.maxConcurrentQueries;
	const econc = endpoint.maxConcurrentQueries;
	return econc != null && econc >= min && econc <= max
		? econc
		: defaultValue;
}

// sept-26: incluyo reintentos para RETRY_CODES
const MAX_RETRIES = 4;
const INITIAL_DELAY = 1000; // 1 segundo
const MAX_RETRY_DELAY = 8000; // 8 segundos
const RETRY_CODES = new Set([429, 502, 503, 504]);

function getLimiter(apiId, endpoint) {
	const key = `${apiId}:${endpoint.id}`;
	if (!limits.has(key)) {
		const conc = getConc(endpoint);
		//const conc = endpoint.maxConcurrentQueries || DEFAULT_CONC;
		logger.info(`Creating limiter for ${key} with concurrency ${conc}`);
		const limit = pLimit(conc);
		limit._conc = conc; // sólo para debug
		limits.set(key, limit);
	}
	return limits.get(key);
}
function removeLimiters(apiId) {
	for (const key of limits.keys()) {
		if (key.startsWith(`${apiId}:`)) {
			logger.info(`Deleting limiter "${key}"`);
			limits.delete(key);
		}
	}
}

async function queryEndpoint(endpoint, querytemp, pars, define, qinfo) {
	const limit = getLimiter(qinfo.apiId, endpoint);
	logger.debug(
		`[${qinfo.apiId}/${endpoint.id}] ` +
		`${limit.activeCount}/${limit._conc} active, ` +
		`${limit.pendingCount} queued`
	);
	return limit(async () => {
		//console.debug(`Sending query from API ${qinfo.apiId} to endpoint ${endpoint.id}`);
		return sendQuery(endpoint, querytemp, pars, define, qinfo);
	});
}


function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendQuery(endpoint, querytemp, pars, define, qinfo) {
	// preparo consulta
	// substitute parameters with mustache	
	let	query = mustache.render(querytemp, pars);
	// preparo los prefijos
	query = includePrefixes(query);
	// oct-26: si hay define en la plantilla, lo incluyo al principio de la consulta
	if (define != null)
		query = `${define}\n${query}`;	

	// preparo URL de la consulta
	const pdata = {};
	if (endpoint.graphURI)
		pdata["default-graph-uri"] = endpoint.graphURI;
	pdata.query = query;
	
	// 2021-10-29 rehecho para adecuarse a Wikidata
	// preparo opciones de la consulta (método HTTP y cabeceras Accept y User-Agent)
	let options = {};	
	// oct-26: si la consulta supera un threshold, hago petición POST
	options.method = Buffer.byteLength(query, "utf8") > config.defaultOptions.endpoints.queryPostThreshold
    	? "POST"
	    : (endpoint.httpMethod || "GET");
	options.headers = {
		"Accept": 'application/sparql-results+json',
		"User-Agent": 'CRAFTS/2.0 (https://crafts.gsic.uva.es/; crafts@gsic.uva.es)'
	};
	
	// 2024/01/12 revisado para hacer bien peticiones POST
	let url = endpoint.sparqlURI; // Base URL for the SPARQL endpoint
	if (options.method === "POST") {
		options.headers['Content-Type'] = 'application/x-www-form-urlencoded'; // Required for URL-encoded POST bodies
		options.body = new URLSearchParams(pdata).toString(); // Send the payload as the POST body
	} 
	else // For GET requests, append the query parameters to the URL
		url += '?' + new URLSearchParams(pdata).toString();

	// bucle de reintentos
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		//console.debug(`[${qinfo.apiId}/${endpoint.id}] attempt #${attempt} - Query:\n${query}`);
				
		const start = Date.now();
	
		let response;
		// preparo autorización si hace falta
		if (endpoint.authInfo) {
			const authops = {
				basic: endpoint.authInfo.type === "basic"
			};
			const client = new DigestClient(endpoint.authInfo.user, endpoint.authInfo.password, authops);		
			response = await client.fetch(url, options); // fetch con autorización
		}
		else // sin autorización
			response = await fetch(url, options); // fetch sin autorización
			
		// mido tiempo de la respuesta
		const elapsed = Date.now() - start;

		if (response.ok) { // if HTTP-status is 200-299
			logger.debug({
				reqId: qinfo.quuid,
				apiId: qinfo.apiId,
				endpoint: endpoint.id,
				query,
				attempt,
				elapsed,
				result: 'success'
			});
			
			// detección consulta lenta
			if (elapsed > 5000) {
				logger.warn({
					reqId: qinfo.quuid,
					apiId: qinfo.apiId,
					endpoint: endpoint.id,
					query,
					elapsed,
					info: 'slow query'
				});
			}
			
			// get the response body and return it
			const json = await response.json();
			// incluyo la consulta
			json.query = query;

			return json;
		}

		// Reintento sólo para RETRY_CODES
		if (RETRY_CODES.has(response.status) && attempt < MAX_RETRIES) {
			let delay;
			const retryAfter = response.headers.get('retry-after');
			if (retryAfter) {
				delay = parseInt(retryAfter, 10) * 1000;
				delay = Math.min(delay, MAX_RETRY_DELAY);
			} 
			else
				delay = INITIAL_DELAY * Math.pow(2, attempt);
			// jitter aleatorio (0-400 ms)
			delay += Math.floor(Math.random() * 400);
			
			//console.warn(`[${qinfo.apiId}/${endpoint.id}] Retrying after HTTP ${response.status} retry-after ${retryAfter}. Delay: ${delay}ms`);

			logger.warn({
				reqId: qinfo.quuid,
				apiId: qinfo.apiId,
				endpoint: endpoint.id,
				status: response.status,
				attempt,
				delay,
				info: `Retrying after HTTP ${response.status}`
			});

			await sleep(delay);
			continue;
		}

		// cualquier otro error
		const error = new Error(
			`HTTP error of API "${qinfo.apiId}" endpoint "${endpoint.id}" - code: ${response.status} - query:\n${query}`
		);
		error.code = response.status;
		throw error;
	}

	// si se superan los reintentos...
	const error = new Error(`Maximum retries exceeded for API "${qinfo.apiId}" endpoint "${endpoint.id}"`);
	error.code = 429;
	throw error;
}

// sept-26: revisión prefijos
const KNOWN_PREFIXES = {
	'http://www.bigdata.com/rdf#': 'bd',
	'http://creativecommons.org/ns#': 'cc',
	'http://purl.org/dc/terms/': 'dct',
	'http://www.opengis.net/ont/geosparql#': 'geo',
	'https://www.mediawiki.org/ontology#API/': 'mwapi',
	'http://www.w3.org/ns/lemon/ontolex#': 'ontolex',

	'http://www.wikidata.org/entity/': 'wd',
	'http://www.wikidata.org/wiki/Special:EntityData/': 'wdata',
	'http://www.wikidata.org/entity/statement/': 'wds',
	'http://www.wikidata.org/reference/': 'wdref',
	'http://www.wikidata.org/value/': 'wdv',

	'http://www.wikidata.org/prop/': 'p',
	'http://www.wikidata.org/prop/direct/': 'wdt',
	'http://www.wikidata.org/prop/direct-normalized/': 'wdtn',
	'http://www.wikidata.org/prop/statement/': 'ps',
	'http://www.wikidata.org/prop/statement/value/': 'psv',
	'http://www.wikidata.org/prop/statement/value-normalized/': 'psn',
	'http://www.wikidata.org/prop/qualifier/': 'pq',
	'http://www.wikidata.org/prop/qualifier/value/': 'pqv',
	'http://www.wikidata.org/prop/qualifier/value-normalized/': 'pqn',
	'http://www.wikidata.org/prop/reference/': 'pr',
	'http://www.wikidata.org/prop/reference/value/': 'prv',
	'http://www.wikidata.org/prop/reference/value-normalized/': 'prn',
	'http://www.wikidata.org/prop/novalue/': 'wdno',

	'http://wikiba.se/ontology#': 'wikibase',
	'https://query.wikidata.org/subgraph/': 'wdsubgraph',

	'http://www.w3.org/ns/prov#': 'prov',
	'http://schema.org/': 'schema',

	'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
	'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
	'http://www.w3.org/2002/07/owl#': 'owl',
	'http://www.w3.org/2001/XMLSchema#': 'xsd',
	'http://www.w3.org/2004/02/skos/core#': 'skos'
};

function isPrefixableIri(iri) {
	return !/[&,()'!]/.test(iri)
		&& iri.indexOf(':') === iri.lastIndexOf(':');
}

function includePrefixes(query) {
	const namespaces = new Map();
	const processedIris = new Set();
	
	const iris = query.match(/<[^<>]+>/g);

	if (!iris)
		return query;

	let prefixes = '';
	let nsIndex = 0;

	for (const iri of iris) {
		if (!isPrefixableIri(iri))
			continue;
		if (processedIris.has(iri))
			continue;
		processedIris.add(iri);
		const splitIndex = Math.max(
			iri.lastIndexOf('/'),
			iri.lastIndexOf('#')
		);
		if (splitIndex <= 8)
			continue;
		const namespace = iri.substring(1, splitIndex + 1);
		let prefix = namespaces.get(namespace);
		if (!prefix) {
			if (KNOWN_PREFIXES[namespace])
				prefix = KNOWN_PREFIXES[namespace];
			else
				prefix = `n${nsIndex++}`;
			namespaces.set(namespace, prefix);
			prefixes += `PREFIX ${prefix}: <${namespace}>\n`;
		}
		const localName = iri.substring(
			splitIndex + 1,
			iri.length - 1
		);
		const replacement = `${prefix}:${localName}`;
		query = query.split(iri).join(replacement);
	}
	return prefixes + query;
}


module.exports = {
	queryEndpoint,
	removeLimiters
}