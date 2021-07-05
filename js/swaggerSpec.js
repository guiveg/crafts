const swaggerJsdoc = require('swagger-jsdoc');
const config = require('../data/config');

const options = {
	swaggerDefinition: {
		openapi: '3.0.0',
		info: {
			title: 'Configurable RESTful APIs For Triple Stores',
			version: '1.0.0',
			license: {
				name: "Apache 2.0",
				url: "http://www.apache.org/licenses/LICENSE-2.0",
			},
			contact: {
				name: "Guillermo Vega-Gorgojo",
				url: "https://www.gsic.uva.es/members/guiveg",
				email: "guiveg@tel.uva.es",
			}
		},
		servers: [
			{
				url: config.scheme + '://' + config.authority + config.prepath
			}
		]
	},
	apis: ['./js/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;