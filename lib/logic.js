'use strict';
/**
 * Company owner issueing company's share on behalf of company
 * @param {org.se.exchange.ShareIssue} shareIssue
 * @transaction
 */
function onShareIssue(shareIssue) {
    var trader = getCurrentParticipant()
    return getParticipantRegistry('org.se.exchange.Company')
        .then(function (companyRegistry){
        return companyRegistry.get(shareIssue.company.getIdentifier())
        .then(function (issueingCompany) {
            return addShare(trader, issueingCompany, shareIssue.count)
            .then(function(){
                issueingCompany.issuedShareCount += shareIssue.count;
                return companyRegistry.update(issueingCompany);
            })
        });
    })
}

/**
 * Transaction proposal for buy or sell
 * @param {org.se.exchange.Propose} proposalRequest
 * @transaction
 */
function onProposal(proposalRequest) {
    if (proposalRequest.count <= 0 || proposalRequest.company == null) {
        //todo : company has to be checked for its existance
        return;//todo : handle error
    }
    var trader = getCurrentParticipant();
    if (proposalRequest.proposalType == 'FOR_SALE') {
        return processSaleOrder(proposalRequest, trader);
    }
    if (proposalRequest.proposalType == 'FOR_BUY') {
        return processBuyOrder(proposalRequest, trader);
    }        
}

function processBuyOrder(proposalRequest, buyer){
    var totalAmount = proposalRequest.count * proposalRequest.price;
    if (buyer.balance < totalAmount) {
        console.log('trader does not have enough balance');
        return; //error has to be thrown
    }
    return query('selectSaleProposalOfCompany', {
        "company": proposalRequest.company.toURI(),
        "price": proposalRequest.price//limit has to be provided
    })
    .then(function(saleProposals){
        var settlementMap = {}, neededShares = proposalRequest.count, trades = [], promises = [];
        saleProposals.forEach(function(saleProposal){
            var buyable = ((saleProposal.count - neededShares) >= 0) ? neededShares : saleProposal.count;
            neededShares -= buyable;
            if(buyable > 0) {
                settlementMap[saleProposal.proposalId] = buyable;
            }
        });
        saleProposals.forEach(function(saleProposal){
            if(settlementMap[saleProposal.proposalId]){
                promises.push(
                    settleCounterProposal(proposalRequest, buyer, saleProposal, "FOR_BUY", settlementMap[saleProposal.proposalId], saleProposal.price)
                );
            }
        });
        return Promise.all(promises)
        .then(function(){
            return addNewProposal(buyer, proposalRequest.company, neededShares, "FOR_BUY", proposalRequest.price);
        })
    })        
}

function processSaleOrder(proposalRequest, seller){
    return query('selectShareByUserAndCompany', {
        "owner": seller.toURI(),
        "company": proposalRequest.company.toURI()
    }).
    then(function(shareRecodrds){
        if(shareRecodrds.length == 0 || shareRecodrds[0].count < proposalRequest.count){
            return; //error has to be returned if the trader does not have enough shares as per the claim;            
        }
        return query('selectBuyProposalOfCompany', { //Fix : has to be in ascending order of price
            company: proposalRequest.company.toURI(),
            price: proposalRequest.price
        })
        .then(function(buyProposals){
            var settlementMap = {}, reaminingForSale = proposalRequest.count, trades = [], promises = [];
            for (var i = 0; i < buyProposals.length && reaminingForSale > 0; i++) {
                var sellable = (reaminingForSale <= buyProposals[i].count) ? reaminingForSale : buyProposals[i].count;
                reaminingForSale -= sellable;
                settlementMap[buyProposals[i].proposalId] = sellable;
            }
            buyProposals.forEach(function(buyProposal){
                if(settlementMap[buyProposal.proposalId]){
                    promises.push(
                        settleCounterProposal(proposalRequest, seller, saleProposal, "FOR_SALE", settlementMap[saleProposal.proposalId], saleProposal.price)
                    );
                }
            })
            return Promise.all(promises)
            .then(function(){
                return addNewProposal(seller, proposalRequest.company, reaminingForSale, "FOR_SALE", proposalRequest.price);
            })
        })        
    })
}

function tradersFromProposals(proposals){
    var traders = [], promises = [];
    getParticipantRegistry('org.se.exchange.Trader')
    .then(function(traderRegistry){
        proposals.forEach(function(proposal){
            promises.push(function(){
                traderRegistry.get(proposal.trader.getIdentifier())
                .then(function (trader) {
                    traders.push(trader);
                })
            })
        })
    })
    return Promise.all(promises)
    .then(function(){
        return traders;
    })
}

function settleCounterProposal(proposal, firstParty, counterProposal, proposalType, count, stockPrice){
    if(proposal.company.getIdentifier() != counterProposal.company.getIdentifier()){
        return //throw error; Cannot settle proposals
    }
    if(firstParty.getIdentifier() == counterProposal.trader.getIdentifier()){
        return //throw error : buy and sell among same trader
    }
    var buyer = (proposalType == "FOR_SALE") ? counterProposal.trader : firstParty;
    var seller = (proposalType == "FOR_SALE") ? firstParty : counterProposal.trader;
    return createTradeEntry(buyer, seller, proposal.company, count, stockPrice)
    .then(function(){
        return transferOwnership(seller, buyer, proposal.company, count, stockPrice)
    })
    .then(function(){
        return closeProposalByCount(counterProposal, count);
    })
}

function transferOwnership(seller, buyer, company, count, stockPrice){
    return reduceShare(seller, company, count)
    .then(function(){
        return addShare(buyer, company, count)
        .then(function(){
            return transferBalance(seller, buyer, stockPrice * count)
            //fix : error on insufficient balance has to be handled
        })
    })
    // .then(function(error){
    //     console.log('insufficient share. To be handled')
    //     //fix: insufficient share. To be handled
    // })
}

function transferBalance(sender, receiver, amount){
    return reduceBalance(sender, amount)
    .then(function(){
        return addBalance(receiver, amount);
    })
}

function addBalance(trader, amount){
    return getParticipantRegistry('org.se.exchange.Trader')
    .then(function (traderRegistry){
        traderRegistry.get(trader.getIdentifier())
        .then(function(trader){
            trader.balance += amount;
            return traderRegistry.update(trader);
        })        
    })
}

function reduceBalance(trader, amount){
    return getParticipantRegistry('org.se.exchange.Trader')
    .then(function(traderRegistry){
        traderRegistry.get(trader.getIdentifier())
        .then(function(trader){
            if(trader.balance - amount < 0){
                return; //throw error; Insufficient balance
            }
            trader.balance -= amount;
            return traderRegistry.update(trader);
        })
    })
}

function createTradeForProposal(proposal, proposalType, counterProposals, settlementList){
    var tradeCreatePromises = [];
    counterProposals.forEach(function(counterProposal){
        if(settlementList[counterProposal.proposalId]){
            var buyer = (proposalType == "FOR_SALE") ? counterProposal.trader : proposal.trader;
            var seller = (proposalType == "FOR_SALE") ? proposal.trader : counterProposal.trader;
            tradeCreatePromises.push(
                createTradeEntry(buyer, seller, proposal.company, 
                    settlementList[counterProposal.proposalId], 
                    counterProposal.price)
            )
        }
    })
    return Promise.all(tradeCreatePromises);
}

function createTradeEntry(buyer, seller, company, count, price){
    var factory = getFactory();
    var trade = factory.newResource("org.se.exchange", "Trade", seller.getIdentifier() + "_" +
        buyer.getIdentifier() + "_" + company.getIdentifier() + new Date().getTime().toString());
    trade.company = company;
    trade.buyer = buyer;
    trade.seller = seller;
    trade.count = count;
    trade.price = price;
    return getAssetRegistry("org.se.exchange.Trade")
    .then(function(tradeRgistry){
        console.log('Trade registry creating..')
        return tradeRgistry.add(trade)
    })
}

function addShare(holder, company, count){
    return getAssetRegistry('org.se.exchange.Share')
    .then(function(shareRegistry){
        return query('selectShareByUserAndCompany', {
            owner: holder.toURI(),
            company: company.toURI()
        })
        .then(function(shareEntry){
            if (shareEntry.length == 0){
                return createShare(holder, company, count, shareRegistry);
            }else{
                return updateShare(shareEntry[0], shareRegistry, count);
            }
        })
    })
}

function reduceShare(holder, company, count){
    return getAssetRegistry('org.se.exchange.Share')
    .then(function(shareRegistry){
        return query('selectShareByUserAndCompany', {
            owner: holder.toURI(),
            company: company.toURI()
        })
        .then(function(shareEntry){
            if (shareEntry.length == 0 || shareEntry[0].count < count){
                return //throw error; Not enough share
            }
            if (shareEntry[0].count == count){
                return removeShare(shareEntry[0]);
            }
            return updateShare(shareEntry[0], shareRegistry, -1 * count);
        })
    })
}

function createShare(holder, company, count, shareRegistry){
    var share = getFactory().newResource("org.se.exchange", "Share", holder.getIdentifier() + "_" +
        company.getIdentifier());
    share.count = count;
    share.company = company;
    share.holder = holder;
    return shareRegistry.add(share);
}

function updateShare(share, shareRegistry, count){
    share.count += count;
    return shareRegistry.update(share);
}

function removeShare(share, shareRegistry){
    return shareRegistry.remove(share)
}

function addNewProposal(trader, company, count, type, price){
    if(count <= 0){
        return;
    }
    var proposal = getFactory().newResource("org.se.exchange", "Proposal", 
        trader.getIdentifier() + "_" +
        new Date().getTime().toString());
    proposal.count = count;
    proposal.type = type;
    proposal.price = price;
    proposal.company = company;
    proposal.trader = trader;
    return addProposal(proposal);
}

function addProposal(proposal){
    return getAssetRegistry('org.se.exchange.Proposal')
    .then(function(proposalRegistry){
        return proposalRegistry.add(proposal);
    })
}

function removeProposal(proposal){
    return getAssetRegistry('org.se.exchange.Proposal')
    .then(function(proposalRegistry){
        return proposalRegistry.remove(proposal.getIdentifier());
    })
}

function updateProposalCount(prposal, count){
    return getAssetRegistry('org.se.exchange.Proposal')
    .then(function(proposalRegistry){
        proposal.count = count;
        return proposalRegistry.update(proposal);
    })
}

function closeProposalByCount(proposal, count){
    if(proposal.count < count) {
        return// insufficient ; throw error
    }
    return getAssetRegistry('org.se.exchange.Proposal')
    .then(function(proposalRegistry){
        if(proposal.count - count == 0){
            return proposalRegistry.remove(proposal.getIdentifier())
        }
        proposal.count -= count;
        return proposalRegistry.update(proposal);
    })
}