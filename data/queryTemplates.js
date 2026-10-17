// query array with all the query templates
const queryTemplates = [
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
		id: "genPredicate",
		description: "Obtain the predicate for an \"objects\" query by directly applying a prop or type of the model",
		template: 
'{{#propexpr}}{{{.}}}{{/propexpr}}{{#propiri}}<{{{.}}}>{{/propiri}}{{^propexpr}}{{^propiri}}a{{#inferred}}/<http://www.w3.org/2000/01/rdf-schema#subClassOf>*{{/inferred}}{{/propiri}}{{/propexpr}}',
		parameters: [ "propexpr", "propiri", "inferred"]
	},
// he detectado errores en Virtuoso al probar las consultas desde el formulario web
// estos errores están asociados a property paths con * o +, además de filtros en las restricciones, ej:
// "Virtuoso 37000 Error SP031: SPARQL compiler: Variable 'spperc' is used in subexpressions of the query but not assigned"
// el problema no es de la consulta (no falla desde curl o CRAFTS), sino del formulario web
// en concreto, incluye el query parameter:		signal_void=on
// hay que quitar ese parámetro para depurar las consultas 
	{ 
		id: "genUnionItem",
		description: "Obtain an union item to build the \"unionsblock\" of a \"multipredobjs\" query by directly applying a prop or type of the model",
		template: 
'{ ?s {{{predicate}}} ?o .\n\
{{#restrictions}}{{{.}}}\n{{/restrictions}}\
 BIND(\"{{label}}\" AS ?pl) }',
		parameters: [ "predicate", "label", "restrictions"]
	},
	{ 
		id: "objects",
		description: "Obtain the subjects (variable \"s\") and objects (variable \"o\") given a list of subjects (parameter \"subjects\" and variable \"s\") and a predicate (parameter \"predicate\"). The query can be paginated and alternative results can be projected. Additional \"restrictions\" can be added, typically to restrict the objects",
		template: 
'SELECT DISTINCT ?s {{^altResult}}?o{{/altResult}}{{#altResult}}{{{.}}}{{/altResult}}\n\
WHERE {\n\
VALUES ?s { {{#subjects}}{{{.}}} {{/subjects}}}\n\
?s {{{predicate}}} ?o .\n\
{{#restrictions}}{{{.}}}\n{{/restrictions}}\
}{{#orderBy}} ORDER BY {{.}}{{/orderBy}}\
{{#limit}}\nLIMIT {{.}}{{/limit}}\
{{#offset}}\nOFFSET {{.}}{{/offset}}',
		variables: [ "s", "o" ],
		parameters: [
			{ label: "subjects", type: "firi[]", optional: false },
			{ label: "predicate", type: "string", optional: false },
			{ label: "restrictions", type: "string[]", optional: true },
			{ label: "altResult", type: "string", optional: true },
			{ label: "orderBy", type: "string", optional: true },
			{ label: "limit", type: "number", optional: true },
			{ label: "offset", type: "number", optional: true }
		]
	},
	{ 
		id: "multipredobjs",
		description: "Obtain the subjects (variable \"s\"), predicate labels (variable \"pl\") and objects (variable \"o\") given a list of subjects (parameter \"subjects\") and a list of unions (parameter \"unionsblock\"). Pagination can be used with \"limit\" and \"offset\"",
		template: 
'SELECT DISTINCT ?s ?pl ?o\n\
WHERE {\n\
VALUES ?s { {{#subjects}}{{{.}}} {{/subjects}}}\n\
{{{unionsblock}}}\n\
}{{#limit}} LIMIT {{.}}{{/limit}}\
{{#offset}}\nOFFSET {{.}}{{/offset}}',
		variables: [ "s", "pl", "o" ],
		parameters: [
			{ label: "subjects", type: "firi[]", optional: false },
			{ label: "unionsblock", type: "string", optional: false },
			{ label: "limit", type: "number", optional: true },
			{ label: "offset", type: "number", optional: true }
		]
	}
];


module.exports = {
	queryTemplates
}