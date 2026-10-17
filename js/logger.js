const winston = require('winston');
require('winston-daily-rotate-file');

// preparo logger con dos transportes y con manejador de excepciones
const logger = winston.createLogger({
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json()
	),
	transports: [
		new winston.transports.DailyRotateFile({
			filename: './logs/info-%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			level: 'info',
			maxSize: '50m',
			maxFiles: '30d',
			zippedArchive: true
		}),
		new winston.transports.DailyRotateFile({
			filename: './logs/error-%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			level: 'error',
			maxSize: '50m',
			maxFiles: '180d',
			zippedArchive: true
		})
	],
	exceptionHandlers: [
		new winston.transports.DailyRotateFile({
			filename: './logs/exceptions-%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			maxFiles: '180d',
			zippedArchive: true
		})
	],
	rejectionHandlers: [
		new winston.transports.DailyRotateFile({
			filename: './logs/rejections-%DATE%.log',
			datePattern: 'YYYY-MM-DD',
			maxFiles: '180d',
			zippedArchive: true
		})
	],
	exitOnError: false
});

// nuevo transporte (consola coloreada) si no está en producción
if (process.env.NODE_ENV !== 'production') {	
	const miformato = winston.format.printf(({ level, message, timestamp }) => {
		const text = typeof message === 'object'? 
			JSON.stringify(message) : message; 
		return `${timestamp} ${level}: ${text}`;
	});

	logger.add(new winston.transports.Console({
  		level: 'debug',
		format: winston.format.combine(
			winston.format.colorize(),
			miformato
		),
	    handleExceptions: true,
	    handleRejections: true
	}));
}


module.exports = logger;