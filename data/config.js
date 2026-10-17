const config = {
	// node server
	port: 8888,
	
	// URI and location preparation
	userPath: "users",
	apisPath: "apis",
	dumpsPath: "dumps",
	dataPath: "data",
	
	// web server
	scheme: "http",
	authority: "localhost:8888",
	prepath: "",
	
	// users, api and dump lists
	usersFile: "users.json",
	listDumpFileEnding: "_dumpIndex.json",
	
	// lang
	nolang: "nolang",
	
	// root
	root: 'changeme',
	rootEmail: 'changeme@email.com',	
	
	// SMTP server
	smtpServer: {
		host: "YOURSMTPSERVER",
		port: 465,
		secure: true,
		auth: {
			user: 'USER',
			pass: 'PASS'
		}
 	},
 	
 	// default options
 	defaultOptions: {
 	   compactQueries: true,
       singletonArrays: "collapse",
       cache: {
         maxSize: 1024 * 1024 * 512, // 512 MB
         ttl: 1000 * 60 * 60 * 24 * 3, // 3 days
		 ttlAutopurge: true, // see lru-cache
		 updateAgeOnGet: true // see lru-cache
       },
       endpoints: {
       	 queryPostThreshold: 4 * 1024, // 4 KB
    	 maxConcurrentQueries: {
    	 	defaultValue: 4,
    	 	min: 1,
    	 	max: 32
    	 },
    	 resourcePage: {
    	 	defaultValue: 100,
    	 	min: 10,
    	 	max: 300
    	 },
    	 limit: {
    	 	defaultValue: 10000,
    	 	min: 1000,
    	 	max: 100000
    	 }
       }
	},
 	
 	// google analytics (optional)
 	gaMeasurementId: "YOURID",
 	gaApiSecret: "YOURSECRET",
 	gaURLbase: "https://www.google-analytics.com/mp/collect"
}

module.exports = config