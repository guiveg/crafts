const winston = require('winston');
require('winston-daily-rotate-file');

// preparo logger con tres transportes y con manejador de excepciones
const logger = winston.createLogger({
    format: winston.format.combine(
		winston.format.timestamp({
			format: 'YYYY-MM-DD HH:mm:ss'
    	}),
  		winston.format.prettyPrint()
	),
	transports: [
    	new winston.transports.DailyRotateFile({
			frequency: '1m',
			filename: './logs/debug-%DATE%.log',
			datePattern: 'YYYY-MM',
			maxSize: '10m',
			level: 'debug',
			format: winston.format.combine(
				winston.format.timestamp({
					format: 'YYYY-MM-DD HH:mm:ss'
    			}),
		  		winston.format.json()
			)
		}),
    	new winston.transports.DailyRotateFile({
			frequency: '1m',
			filename: './logs/info-%DATE%.log',
			datePattern: 'YYYY-MM',
			maxSize: '10m',
			level: 'info'
		}),
		new winston.transports.DailyRotateFile({
			frequency: '1m',
			filename: './logs/error-%DATE%.log',
			datePattern: 'YYYY-MM',
			maxSize: '10m',
			level: 'error'
		})
	],
	exceptionHandlers: [
		new winston.transports.File({ filename: './logs/exceptions.log' })
	],
	exitOnError: false
});

// nuevo transporte si no está en producción
if (process.env.NODE_ENV !== 'production') {	
	const miformato = winston.format.printf(({ level, message, label, timestamp }) => {
		// transformo en cadena objeto JSON para que pueda presentarse por consola
		let stmens = (typeof message === 'object')? JSON.stringify(message) : message;
		return `${timestamp} ${level}: ${stmens}`;
	});

	logger.add(new winston.transports.Console({
  		level: 'debug',
		format: winston.format.combine(
			winston.format.colorize(),
			miformato
		),
	    handleExceptions: true
	}));
}


module.exports = logger;