'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {fields,validateSettings,requireIssuer}=require('../services/invoiceSettings');
const empty=()=>Object.fromEntries(fields.map(f=>[f,'']));
test('Rechnungssteller fehlen: keine Rechnung mit erfundenen Pflichtangaben',async()=>{await assert.rejects(requireIssuer({execute:async()=>[[]]}),/vollständigen/);});
test('Rechnungssteller prüfen E-Mail und IBAN',()=>{assert.throws(()=>validateSettings({...empty(),email:'a@b.de\r\nBcc:x@y.de'}));assert.throws(()=>validateSettings({...empty(),iban:'bad'}));assert.equal(validateSettings({...empty(),email:' a@b.de '}).email,'a@b.de');});
test('Rechnungskorrektur kehrt Steuer und Brutto exakt um',()=>{const {totals}=require('../services/invoicePdf');const positive=totals([{grossCents:15999,vatRate:19}]);const negative=totals([{grossCents:-15999,vatRate:19}]);assert.equal(positive.net+negative.net,0);assert.equal(positive.tax+negative.tax,0);assert.equal(positive.gross+negative.gross,0);});
