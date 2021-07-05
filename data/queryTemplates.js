// query array with all the query templates
var queryTemplates = [
	{ 
		id: "test",
		description: "Test if an endpoint is working",
		template: 
'SELECT *\n\
WHERE {\n\
?s ?p ?o .\n\
} LIMIT 1',
		variables: [ "s", "p", "o" ],
		parameters: []
	},
	{ 
		id: "testInsert",
		description: "Test insert data of an endpoint",
		template: 
'INSERT DATA {\n\
<http://prueba.es/s> <http://prueba.es/p> <http://prueba.es/o>\n\
}',
		variables: [],
		parameters: []
	},
	{ 
		id: "testDelete",
		description: "Test delete data of an endpoint",
		template: 
'DELETE DATA {\n\
<http://prueba.es/s> <http://prueba.es/p> <http://prueba.es/o>\n\
}',
		variables: [],
		parameters: []
	},
	{ 
		id: "types",
		description: "Obtain the types of a list of iris (\"firis\"). The inferred types can be also obtained by setting \"inferred\" to true. Additional \"restrictions\" can be added, e.g. to filter the types to extract",
		template: 
'SELECT DISTINCT ?iri ?type  \n \
WHERE { \n \
?iri a{{#inferred}}/<http://www.w3.org/2000/01/rdf-schema#subClassOf>*{{/inferred}} ?type . \n \
{{#restrictions}}{{{.}}}\n{{/restrictions}}\
FILTER (?iri IN ( {{{firis}}} )) }',
		variables: [ "iri", "type" ],
		parameters: [
			{ label: "firis", type: "firi[]", optional: false },
			{ label: "inferred", type: "boolean", optional: true },
			{ label: "restrictions", type: "string[]", optional: true }		
		]
	},
	{ 
		id: "propvalues",
		description: "Obtain the values of a property \"propiri\" of a list of iris (\"firis\"). The property can be inversed by setting  \"inv\" to true. Additional \"restrictions\" can be added, e.g. to filter the values to extract",
		template: 
'SELECT DISTINCT ?iri ?value \n\
WHERE { \n\
{{^inv}}?iri <{{{propiri}}}> ?value . \n{{/inv}}\
{{#inv}}?value <{{{propiri}}}> ?iri . \n{{/inv}}\
{{#restrictions}}{{{.}}}\n{{/restrictions}}\
FILTER (?iri IN ( {{{firis}}} )) }',
		variables: [ "iri", "value" ],
		parameters: [
			{ label: "firis", type: "firi[]", optional: false },
			{ label: "inv", type: "boolean", optional: true },
			{ label: "restrictions", type: "string[]", optional: true }		
		]
	}
];


module.exports = {
	queryTemplates
}