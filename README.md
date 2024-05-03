## Apollo Order Manager
Modular tool for being able to give in some project-related data with direct sign support for the user and direct download of the generated .pdf

## Description
Development of an Order Acceptance Module with Signature Feature and PDF Export. This interactive form enables users to input detailed job information and confirm their consent with a digital signature. After submission, the data can be automatically converted into a PDF document suitable for archiving or sending to clients and partners. This solution streamlines the order acceptance process, reduces paperwork, and enhances the efficiency and accuracy of data collection.

## Visuals
(Will be added in the future)

## Installation
docker pull ascvisiondocker/apollo_order_manager:latest

## Usage
A Apollo Module to entry an order digitally, offering customer to directly sign an order In-App and export the collected data into a .pdf-file for further usage

## Roadmap and Project Status
- Finalizing Frontend - Nearly DONE
- Implementing the signature field for users being able to sign directly In-App - DONE
- Form Data to .json Export - DONE
- .json Data to .pdf Export - DONE
- Standalone version usable in a docker container - DONE
- Database Connection - In Progress
- Integration into Apollo - In Progress

## Authors and acknowledgment
Leon Pllana @ ASC-Vision

## Resources
Node-Modules: 
"pdf-lib": "^1.17.1" - https://pdf-lib.js.org
"node-fetch": "^2.7.0" - https://github.com/node-fetch/node-fetch
"file-saver": "^2.0.5" - https://github.com/eligrey/FileSaver.js#readme
"express": "^4.18.2" - https://expressjs.com
"dotenv": "^16.4.4" - https://github.com/motdotla/dotenv#readme
"cors": "^2.8.5" - https://github.com/expressjs/cors#readme
"bootstrap-icons": "^1.11.3" - https://icons.getbootstrap.com

Javascript Modules: 
@popperjs/core v2.11.8 - https://github.com/floating-ui/floating-ui#readme
Signature Pad v2.3.2 - https://github.com/szimek/signature_pad
Tempus Dominus v6.9.4 - https://getdatepicker.com/


