'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {quoteTariff,hourlyCharge,hourlyLateFee,earlyReturnCredit,normalizeHourlyPrices}=require('../services/rentalTariffs');
const product={price_per_day:100,hourly_prices:{2:40,4:65,6:85}};
test('hourly bookings use fixed package prices and reject disabled or malformed tariffs',()=>{
 for(const [hours,amount] of [[2,40],[4,65],[6,85],[8,100]])assert.equal(quoteTariff(product,{rentalHours:hours,rentalStartTime:'08:00',rentalStart:'2026-10-01',rentalEnd:'2026-10-01'}).pricePerDay,amount);
 assert.throws(()=>quoteTariff({...product,hourly_prices:null},{rentalHours:2}),/nicht angeboten/);
 assert.throws(()=>quoteTariff(product,{rentalHours:2,rentalStartTime:'23:00',rentalStart:'2026-10-01',rentalEnd:'2026-10-01'}),/Mitternacht/);
 assert.throws(()=>normalizeHourlyPrices({2:70,4:60,6:90},100),/aufsteigend/);
});
test('late hourly returns charge the next agreed tier; early returns do not refund package prices',()=>{
 const item={rental_hours:2,rental_start:'2026-10-01',rental_end:'2026-10-01',rental_start_time:'08:00',tariff_prices:{2:40,4:65,6:85,8:100}};
 assert.equal(hourlyLateFee(item,'2026-10-01','09:00').amount,0);
 assert.equal(hourlyLateFee(item,'2026-10-01','10:00').amount,0);
 assert.equal(hourlyLateFee(item,'2026-10-01','10:01').amount,25);
 assert.equal(hourlyLateFee(item,'2026-10-01','12:01').amount,45);
 assert.equal(hourlyLateFee(item,'2026-10-01','16:01').amount,100);
 assert.equal(hourlyCharge(item.tariff_prices,960),200);
 assert.equal(earlyReturnCredit(item,'2026-10-01').amount,0);
});
test('early day returns refund only unused full days with original discount, independently of deposit',()=>{
 const item={rental_start:'2026-10-01',rental_end:'2026-10-05',price_per_day:100,discount_amount:50,deposit:1000};
 assert.deepEqual(earlyReturnCredit(item,'2026-10-03'),{days:2,amount:180});
 assert.deepEqual(earlyReturnCredit(item,'2026-10-05'),{days:0,amount:0});
 assert.deepEqual(earlyReturnCredit({...item,adjusted_rental_end:'2026-10-07'},'2026-10-04'),{days:3,amount:290});
 assert.throws(()=>earlyReturnCredit(item,'2026-09-30'),/Mietbeginn/);
});
