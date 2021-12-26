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
 	
 	// timespan of a resource in the cache
 	daysCache: 3,
 	millisecsCleanCache: 60*60*1000, // every hour
 	
 	// google analytics
 	gaTrackId: 'YOURID'
}

module.exports = config
