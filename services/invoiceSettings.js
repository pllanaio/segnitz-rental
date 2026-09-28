'use strict';
const fields=['name','address','postalCode','city','taxId','email','iban','bic','accountHolder','registerInfo','managingDirectors'];
function validateSettings(input){
 const settings={};
 for(const field of fields){if(typeof input[field]!=='string'||input[field].length>500)throw Object.assign(new Error('Bitte die Rechnungssteller-Daten prüfen.'),{statusCode:400});settings[field]=input[field].trim();}
 if(settings.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(settings.email))throw Object.assign(new Error('Ungültige E-Mail-Adresse.'),{statusCode:400});
 settings.iban=settings.iban.replace(/\s/g,'').toUpperCase();
 if(settings.iban&&!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(settings.iban))throw Object.assign(new Error('Ungültige IBAN.'),{statusCode:400});
 if(settings.iban){const rearranged=settings.iban.slice(4)+settings.iban.slice(0,4);let remainder=0;for(const character of rearranged){for(const digit of (/^[A-Z]$/.test(character)?String(character.charCodeAt(0)-55):character))remainder=(remainder*10+Number(digit))%97;}if(remainder!==1)throw Object.assign(new Error('Die IBAN-Prüfsumme ist ungültig.'),{statusCode:400});}
 return settings;
}
async function getInvoiceSettings(c){const [[row]]=await c.execute('SELECT settings_json,revision FROM billing_settings WHERE id=1');return {settings:row?(typeof row.settings_json==='string'?JSON.parse(row.settings_json):row.settings_json):Object.fromEntries(fields.map(f=>[f,''])),revision:row?.revision||0};}
async function requireIssuer(c){const {settings}=await getInvoiceSettings(c);if(['name','address','postalCode','city','taxId','email'].some(f=>!settings[f]))throw Object.assign(new Error('Bitte zuerst die vollständigen Rechnungssteller-Daten unter Rechnungen hinterlegen.'),{statusCode:409});return settings;}
module.exports={fields,validateSettings,getInvoiceSettings,requireIssuer};
