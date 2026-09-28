'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const scope=vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../public/js/order_details.js'),'utf8'),scope);
test('combined payments hide rental/deposit allocations but retain distinct failed attempts',()=>{
 const order={payment_method:'invoice',invoice_combined_payment:1,payments:[
  {id:1,paymentType:'invoice_payment',paymentStatus:'cancelled',providerPaymentKey:'old',amount:750},
  {id:2,paymentType:'invoice_payment',paymentStatus:'paid',paymentMethod:'online',providerPaymentKey:'new',amount:750},
  {id:3,paymentType:'deposit',paymentStatus:'paid',paymentMethod:'online',providerPaymentKey:'new',amount:300,note:'Kautionsanteil'},
  {id:4,paymentType:'rental',paymentStatus:'paid',paymentMethod:'online',providerPaymentKey:'new',amount:450},
  {id:5,paymentType:'rental_adjustment',paymentStatus:'paid',paymentMethod:'online',providerPaymentKey:'extra',amount:80}
 ]};
 assert.equal(JSON.stringify(scope.visibleOrderPayments(order).map(p=>p.id)),JSON.stringify([1,2,5]));
 assert.equal(scope.visibleOrderPayments(order).filter(p=>p.paymentStatus==='paid').reduce((n,p)=>n+p.amount,0),830);
});
test('historical separate invoice deposit remains a real payment',()=>{
 const payments=[{id:1,paymentType:'invoice_payment',paymentStatus:'paid',amount:450},{id:2,paymentType:'deposit',paymentStatus:'paid',amount:300}];
 assert.equal(scope.visibleOrderPayments({payment_method:'invoice',invoice_combined_payment:0,payments}).length,2);
});
test('two records for the same Mollie payment appear once, retries remain separate',()=>{
 const payments=[{id:1,paymentType:'initial_payment',providerPaymentKey:'same'},{id:2,paymentType:'invoice_payment',providerPaymentKey:'same'},{id:3,paymentType:'invoice_payment',providerPaymentKey:'retry'}];
 assert.equal(JSON.stringify(scope.visibleOrderPayments({payments}).map(p=>p.id)),JSON.stringify([2,3]));
});

test('payment labels and picked-up tone are shared across views',()=>{
 assert.equal(scope.orderStateTone('picked_up'),'is-paid');
 for(const status of ['open','pending','unpaid'])assert.equal(scope.paymentStatusLabel(status),'Ausstehend');
 assert.equal(scope.paymentStatusLabel('cancelled'),'Abgebrochen');
 assert.equal(scope.paymentStatusLabel('paid'),'Bezahlt');
});

vm.runInContext(fs.readFileSync(require.resolve('../public/js/order_settlement.js'),'utf8'),scope);
function settlementFixture(){return {items:[{id:30,title:'Radlader',rentalStart:'2026-09-28',rentalEnd:'2026-10-02',pricePerDay:1500,deposit:20000,itemStatus:'returned_late_damaged',actualReturnDate:'2026-10-11',additionalChargeAmount:2500,additionalChargeReason:'Reparatur Hydraulik',depositDeductionAmount:16000,depositRefundAmount:4000}],payments:[{id:1,paymentType:'initial_payment',paymentStatus:'paid',amount:27500}]};}
test('late damaged return explains costs and the 4000 EUR refund without double charging deposit',()=>{
 const result=scope.orderSettlement(settlementFixture());assert.equal(result.costs,2350000);assert.equal(result.retained,1600000);assert.equal(result.balance,-400000);assert.equal(result.held,0);assert.equal(result.lines[1].amount,1350000);assert.equal(result.lines[2].reason,'Reparatur Hydraulik');
});
test('already paid refund clears the balance; failed attempts do not count',()=>{
 const order=settlementFixture();order.payments.push({id:2,paymentType:'deposit_refund',paymentStatus:'failed',amount:-4000});assert.equal(scope.orderSettlement(order).balance,-400000);
 order.payments.push({id:3,paymentType:'deposit_refund',paymentStatus:'paid',amount:-4000});assert.equal(scope.orderSettlement(order).balance,0);
});
test('costs exceeding deposit show only the remaining payment, then clear when paid',()=>{
 const order=settlementFixture();order.items[0].additionalChargeAmount=8000;assert.equal(scope.orderSettlement(order).balance,150000);
 order.payments.push({id:2,paymentType:'return_additional_charge',paymentStatus:'paid',amount:1500});assert.equal(scope.orderSettlement(order).balance,0);
});
test('unreturned deposit remains held and unpaid invoice is never treated as received',()=>{
 const order=settlementFixture();order.items[0].itemStatus='picked_up';const result=scope.orderSettlement(order);assert.equal(result.held,2000000);assert.equal(result.balance,0);assert.equal(result.complete,false);
 order.payments[0].paymentStatus='pending';assert.equal(scope.orderSettlement(order).balance,2750000);
});
test('extension offset against deposit is not charged twice',()=>{
 const order=settlementFixture();Object.assign(order.items[0],{itemStatus:'returned_ok',adjustedRentalEnd:'2026-10-03',actualReturnDate:'2026-10-03',additionalChargeAmount:0});order.payments.push({id:2,paymentType:'rental_adjustment',paymentStatus:'offset',amount:1500});assert.equal(scope.orderSettlement(order).balance,-1850000);
});
