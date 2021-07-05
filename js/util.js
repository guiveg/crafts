const crypto = require('crypto');
const fs = require('fs');
const fsPromises = fs.promises;

async function checkFile(path) {	
	try {
		await fsPromises.access(path, fs.constants.F_OK);
		return true;
	} catch(err) {
		return false;
	}
}

async function loadFile(path) {
	// leemos los datos
	let fh = null;
	try {
		fh = await fsPromises.open(path, 'r');
		let data = await fh.readFile('utf8');
		await fh.close();
		// parseamos y devolvemos
		let datos = JSON.parse(data);		
		return datos;
	}  catch(err) {
		// cierro el fichero si hace falta
		if (fh)
			await fh.close();
		// y terminamos lanzando un error
		throw new Error("Error loading the file with path " + path + ": " + err.message);
	}
}

async function saveFile(path, data) {
	// grabamos los datos
	let datos = JSON.stringify(data, undefined, 2); // salida bonita		
	let fh = null;
	try {
		fh = await fsPromises.open(path, 'w');
		await fh.write(datos);
		await fh.close();
	} catch(err) {	
		// cierro el fichero si hace falta		
		if (fh) 
			await fh.close();
		// borro el fichero si existiera
		await fsPromises.unlink(path);
		// y terminamos lanzando un error		
		throw new Error("Error writing the file with path " + path + ": " + err.message);
	}
}

async function deleteFile(path) {
	const existe = await checkFile(path);
	if (existe)
		await fsPromises.unlink(path);
}

function getHash(obj) {
	// serializo el objeto	
	const cadena = JSON.stringify(obj);
	// devuelvo el hash
	return crypto.createHash('md5').update(cadena).digest('hex');
}



module.exports = {
	checkFile,
	loadFile,
	saveFile,
	deleteFile,
	getHash
}