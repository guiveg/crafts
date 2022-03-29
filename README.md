CRAFTS: Configurable REST APIs For Triple Stores
==========
CRAFTS (Configurable REST APIs For Triple Stores) is a configurable generator of REST APIs to simplify access to triple stores.
CRAFTS allows knowledge engineers to configure REST APIs over multiple triple stores. 
Web developers can then use a CRAFTS API to read and write Linked Open Data. 
CRAFTS automatically handles the translation of API calls into SPARQL queries, delivering results in JSON format. 
The API of CRAFTS is uniform, domain-independent, and described with the OpenAPI specification. 


Please cite CRAFTS as:

> G. Vega-Gorgojo, "CRAFTS: Configurable REST APIs for Triple Stores," in IEEE Access, vol. 10, pp. 32426-32441, 2022, doi: 10.1109/ACCESS.2022.3160610.

[Get the publication PDF](https://ieeexplore.ieee.org/document/9737489)

Target audience
==========
* Web developers struggling with Linked Open Data
* Semantic Web practitioners


Key features
==========
* Generic approach for creating REST APIs over Linked Open Data
* Expose RDF resources through a CRAFTS API
* Read and write operations over RDF resources
* Easy formulation of parametrized SPARQL queries
* Access to multiple triple stores


Installation
==========
CRAFTS is a Node.js web application. Edit the `data/config.js` file to parametrize your deployment (parameters are auto-descriptive).

Assuming `npm` is installed, launching CRAFTS just requires the following two commands:

```console
$ npm update
$ node app.js
```

Alternatively, you can just try a live version of CRAFTS on [https://crafts.gsic.uva.es](https://crafts.gsic.uva.es)


Training
==========
* [A quick introduction to CRAFTS](https://crafts.gsic.uva.es/CRAFTSslides.pdf)
* [A guide for using an API CRAFTS](https://crafts.gsic.uva.es/CRAFTSaccess101.pdf)
* [A guide for configuring an API CRAFTS](https://crafts.gsic.uva.es/CRAFTSconfig101.html)


Help us to improve
==========
CRAFTS is available under an Apache 2.0 license. Please send us an email to [guiveg@tel.uva.es](mailto:guiveg@tel.uva.es) if you use or plan to use CRAFTS. Drop us also a message if you have comments or suggestions for improvement.
