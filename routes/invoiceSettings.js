'use strict';
const {validateSettings,getInvoiceSettings}=require('../services/invoiceSettings');
function registerInvoiceSettingsRoutes(app,{checkAdmin,limiter,createConnection}){
 const fail=(res,e)=>res.status(e.statusCode||503).json({error:e.statusCode?e.message:'Rechnungseinstellungen nicht verfügbar.'});
 app.get('/admin/invoice-settings',checkAdmin,async(req,res)=>{let c;try{c=await createConnection();res.set('Cache-Control','no-store').json(await getInvoiceSettings(c));}catch(e){fail(res,e);}finally{if(c)await c.end();}});
 app.put('/admin/invoice-settings',checkAdmin,limiter,async(req,res)=>{let c;try{
  const settings=validateSettings(req.body.settings||{}),revision=req.body.revision;
  if(!Number.isSafeInteger(revision)||revision<0)throw Object.assign(new Error('Ungültiger Änderungsstand.'),{statusCode:400});
  c=await createConnection();const [r]=revision===0?await c.execute('INSERT IGNORE INTO billing_settings(id,settings_json) VALUES(1,?)',[JSON.stringify(settings)]):await c.execute('UPDATE billing_settings SET settings_json=?,revision=revision+1 WHERE id=1 AND revision=?',[JSON.stringify(settings),revision]);
  if(!r.affectedRows)throw Object.assign(new Error('Zwischenzeitlich geändert. Bitte neu laden.'),{statusCode:409});
  res.json({revision:revision+1,message:'Rechnungssteller gespeichert.'});
 }catch(e){fail(res,e);}finally{if(c)await c.end();}});
}
module.exports={registerInvoiceSettingsRoutes};
