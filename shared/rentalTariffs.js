(function(){
'use strict';
const fail=message=>Object.assign(new Error(message),{statusCode:400});
const cents=value=>Math.round(Number(value)*100);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
function normalizeHourlyPrices(value, dayPrice) {
    if(value==null||value==='')return null;
    let input;try{input=parse(value);}catch{throw fail('Ungültige Stundentarife.');}
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Ungültige Stundentarife.');
    const prices={};let previous=0;
    for(const hours of [2,4,6]){
        const price=Number(input[hours]);
        if(!Number.isFinite(price)||price<=0||price>Number(dayPrice)||cents(price)<previous)throw fail('Die Preise für 2, 4 und 6 Stunden müssen positiv, aufsteigend und höchstens so hoch wie der Tagespreis sein.');
        prices[hours]=cents(price)/100;previous=cents(price);
    }
    prices[8]=cents(dayPrice)/100;return prices;
}
function quoteTariff(product,{rentalHours=null,rentalStartTime=null,rentalStart,rentalEnd}) {
    if(rentalHours==null||rentalHours==='')return {rentalHours:null,rentalStartTime:null,tariffPrices:null,pricePerDay:Number(product.price_per_day)};
    const hours=Number(rentalHours),prices=normalizeHourlyPrices(product.hourly_prices,product.price_per_day);
    if(![2,4,6,8].includes(hours)||!prices)throw fail('Dieser Stundentarif wird für den Artikel nicht angeboten.');
    if(rentalStart!==rentalEnd)throw fail('Eine Stundenmiete muss an einem Kalendertag liegen.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(rentalStartTime)))throw fail('Bitte eine gültige Startzeit angeben.');
    const [h,m]=rentalStartTime.split(':').map(Number);
    if(h*60+m+hours*60>1440)throw fail('Die Stundenmiete muss spätestens um Mitternacht enden.');
    return {rentalHours:hours,rentalStartTime,tariffPrices:prices,pricePerDay:prices[hours]};
}
function hourlyCharge(prices,minutes) {
    prices=parse(prices);const full=Math.floor(Math.max(0,minutes-1)/480),rest=Math.max(0,minutes)-full*480;
    const tier=[2,4,6,8].find(h=>rest<=h*60)||8;
    return (full*cents(prices[8])+cents(prices[tier]))/100;
}
function hourlyLateFee(item,returnDate,returnTime) {
    if(!item.rental_hours)return null;
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(returnTime)))throw fail('Bitte die tatsächliche Rückgabezeit angeben.');
    const start=String(item.rental_start).slice(0,10)+'T'+String(item.rental_start_time).slice(0,5)+':00Z';
    const elapsed=Math.ceil((Date.parse(returnDate+'T'+returnTime+':00Z')-Date.parse(start))/60000);
    if(!Number.isFinite(elapsed)||elapsed<0)throw fail('Die Rückgabe darf nicht vor dem Mietbeginn liegen.');
    const booked=Number(item.adjusted_rental_hours||item.rental_hours),prices=parse(item.tariff_prices);
    return {minutesLate:Math.max(0,elapsed-booked*60),amount:Math.max(0,Math.round((hourlyCharge(prices,Math.max(elapsed,booked*60))-hourlyCharge(prices,booked*60))*100)/100)};
}
function earlyReturnCredit(item,actualReturnDate) {
    if(item.rental_hours)return {days:0,amount:0};
    const start=String(item.adjusted_rental_start||item.rental_start).slice(0,10),end=String(item.adjusted_rental_end||item.rental_end).slice(0,10);
    const days=Math.max(0,Math.round((Date.parse(end)-Date.parse(actualReturnDate))/86400000));
    const originalDays=Math.round((Date.parse(String(item.rental_end).slice(0,10))-Date.parse(String(item.rental_start).slice(0,10)))/86400000)+1;
    const originalUnused=Math.max(0,Math.round((Date.parse(String(item.rental_end).slice(0,10))-Date.parse(actualReturnDate))/86400000));
    const price=Number(item.adjusted_price_per_day||item.price_per_day);
    // Discount only applies to the original booking; extension days were charged at full price.
    const amount=Math.max(0,days*cents(price)-Math.round(cents(item.discount_amount||0)*Math.min(originalUnused,originalDays)/originalDays));
    if(actualReturnDate<start)throw fail('Die Rückgabe darf nicht vor dem Mietbeginn liegen.');
    return {days,amount:amount/100};
}
const api={normalizeHourlyPrices,quoteTariff,hourlyCharge,hourlyLateFee,earlyReturnCredit};
module.exports=api;

})();
