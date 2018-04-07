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
    var factory = getFactory();
    var trader = getCurrentParticipant();
    //todo : ACL has to be impplemented to check whether current user is qualified to 
    //perform the transaction
    var proposalId = trader.email + new Date().getTime().toString();
    var proposal = factory.newResource('org.se.exchange', 'Proposal', proposalId)
    proposal.type = proposalRequest.proposalType;
    proposal.price = proposalRequest.price;
    proposal.company = proposalRequest.company;
    proposal.trader = trader;
    return getParticipantRegistry('org.se.exchange.Trader')
    .then(function (traderRegistry) {
        return getAssetRegistry('org.se.exchange.Share')
        .then(function (shareRegistry) {
            return getAssetRegistry('org.se.exchange.Proposal')
            .then(function (proposalRegistry) {
                if (proposalRequest.proposalType == 'FOR_SALE') {
                    return executeSaleOrder(proposalRequest, proposal, trader, traderRegistry, shareRegistry, proposalRegistry);
                }
                if (proposalRequest.proposalType == 'FOR_BUY') {
                    return executeBuyOrder(proposalRequest, proposal, trader, traderRegistry, shareRegistry, proposalRegistry);
                }
            })
        })
    })
}

function executeBuyOrder(proposalRequest, newProposal, trader, traderRegistry, shareRegistry, proposalRegistry) {
    var totalAmount = proposalRequest.count * proposalRequest.price;
    if (trader.balance < totalAmount) {
        console.log('trader does not have enough balance');
        return; //error has to be thrown
    }
    return query('selectSaleProposalOfCompany', {
        "company": proposalRequest.company.toURI(),
        "price": proposalRequest.price//limit has to be provided
    })
        .then(function (saleProposals) {
            console.log('Sale Proposals Obtained; Length : ', saleProposals.length)
            var traders = {}, sellerResolvePromises = [], proposalStatus = {};
            saleProposals.forEach(function (saleProposal) {
                sellerResolvePromises.push(
                    traderRegistry.get(saleProposal.trader.getIdentifier())
                        .then(function (seller) {
                            traders[saleProposal.trader.email] = seller;
                        })
                )
            })
            return Promise.all(sellerResolvePromises)
                .then(function () {
                    var sharesToBeTransfered = {},
                        promisesOuter = [],
                        neededShares = proposalRequest.count,
                        settlementMap = {};
                    saleProposals.forEach(function (saleProposal) {
                        var buyable = ((saleProposal.count - neededShares) >= 0) ? neededShares : saleProposal.count;
                        // neededShares -= buyable;
                        settlementMap[saleProposal.proposalId] = buyable;

                        var proposalRemaining = saleProposal.count - neededShares,
                            takeAway = 0;
                        if (proposalRemaining < 0) {
                            takeAway = saleProposal.count;
                            neededShares = neededShares - takeAway;
                        } else {
                            takeAway = neededShares;
                            neededShares = 0;
                        }
                        promisesOuter.push(
                            query('selectShareByUserAndCompanyLimit', {
                                owner: saleProposal.trader.toURI(),
                                company: saleProposal.company.toURI(),
                                limit: takeAway
                            })
                                .then(function (shares) {
                                    sharesToBeTransfered[saleProposal.proposalId] = shares;
                                    proposalStatus[saleProposal.proposalId] = proposalRemaining;
                                })
                        )
                    });
                    return Promise.all(promisesOuter)
                        .then(function () {
                            var promisesInner = [], buyer = trader, shareList = [];
                            traders[buyer.email] = buyer;
                            saleProposals.forEach(function (saleProposal) {
                                var seller = saleProposal.trader;
                                var shares = sharesToBeTransfered[saleProposal.proposalId];
                                shares.forEach(function (share) {
                                    share.holder = buyer;
                                    shareList.push(share);
                                });
                                var amount = saleProposal.price * shares.length;
                                traders[seller.email].balance += amount;
                                traders[buyer.email].balance -= amount;
                            })
                            return shareRegistry.updateAll(shareList)
                        })
                        .then(function(){
                            return createTradeForProposal(newProposal, "FOR_BUY", saleProposals, settlementMap);
                        })
                        .then(function () {
                            var traderList = []
                            for (var k in traders) {
                                traderList.push(traders[k])
                            }
                            return traderRegistry.updateAll(traderList)
                        })
                        .then(function () {
                            if (neededShares > 0) {
                                newProposal.count = neededShares;
                                return proposalRegistry.add(newProposal);
                            }
                        })
                        .then(function () {
                            var propRemovalPromises = [];
                            for (var proposalId in proposalStatus) {
                                if (proposalStatus[proposalId] <= 0) {
                                    propRemovalPromises.push(
                                        proposalRegistry.remove(proposalId)
                                    )
                                }
                            }
                            return Promise.all(propRemovalPromises);
                        })
                        .then(function () {
                            var propsToBeModified = [];
                            saleProposals.forEach(function (saleProposal) {
                                if (proposalStatus[saleProposal.proposalId] > 0) {
                                    saleProposal.count = proposalStatus[saleProposal.proposalId];
                                    propsToBeModified.push(saleProposal);
                                }
                            })
                            return proposalRegistry.updateAll(propsToBeModified);
                        });
                });
        })
}

function executeSaleOrder(proposalRequest, newProposal, seller, traderRegistry, shareRegistry, proposalRegistry) {
    return query('selectShareByUserAndCompanyLimit', {
        "owner": seller.toURI(),
        "company": proposalRequest.company.toURI(),
        "limit": proposalRequest.count
    })
    .then(function(tradingShares){
        if (tradingShares.length < proposalRequest.count) {
            console.log('Trader does not have enough shares as per claim')
            return; //error has to be returned if the trader does not have enough shares as per the claim;
        }
        var reaminingForSale = proposalRequest.count,
            settlementMap = {},
            traderMap = {};
        traderMap[seller.getIdentifier()] = seller;
        return query('selectBuyProposalOfCompany', { //Fix : has to be in ascending order of price
            company: proposalRequest.company.toURI(),
            price: proposalRequest.price
        })
        .then(function(buyProposals){
            var buyerResolvingPromises = [];
            buyProposals.forEach(function(buyProposal){
                buyerResolvingPromises.push(
                    traderRegistry.get(buyProposal.trader.getIdentifier())
                    .then(function(buyer){
                        traderMap[buyProposal.trader.getIdentifier()] = buyer;
                    })
                )
            })
        return Promise.all(buyerResolvingPromises)
        .then(function(){
            var shareIndex = 0;
            for(var i = 0; i< buyProposals.length && reaminingForSale > 0; i++){
                var sellable = (reaminingForSale <= buyProposals[i].count) ? reaminingForSale : buyProposals[i].count;
                reaminingForSale -= sellable;
                settlementMap[buyProposals[i].proposalId] = sellable;                
            }
            buyProposals.forEach(function(buyProposal){
                if(settlementMap[buyProposal.proposalId]){
                    var sellable = settlementMap[buyProposal.proposalId];
                    for (var i = 0; i < sellable; i++ , shareIndex++) {
                        tradingShares[shareIndex].holder = buyProposal.trader;
                    }                
                }
            });
            return shareRegistry.updateAll(tradingShares)
            .then(function(){
                return createTradeForProposal(newProposal, "FOR_SALE", buyProposals, settlementMap);
            })
            .then(function () {
                var traderList = [];
                buyProposals.forEach(function(buyProposal){
                    if(settlementMap[buyProposal.proposalId]){
                        var amount = buyProposal.price * settlementMap[buyProposal.proposalId];
                        traderMap[seller.getIdentifier()].balance += amount;
                        traderMap[buyProposal.trader.getIdentifier()].balance -= amount;
                        traderList.push(traderMap[buyProposal.trader.getIdentifier()]);
                    }
                })
                traderList.push(traderMap[seller.getIdentifier()]);
                return traderRegistry.updateAll(traderList);
            })
            .then(function(){
                var closingPromises = [];
                buyProposals.forEach(function(buyProposal){
                    if(settlementMap[buyProposal.proposalId] 
                        && buyProposal.count - settlementMap[buyProposal.proposalId] == 0){
                        closingPromises.push(
                            proposalRegistry.remove(buyProposal)
                        )
                    }
                })
                return Promise.all(closingPromises);
            })
            .then(function() {
                var partialClosingProposals = [];
                buyProposals.forEach(function (buyProposal) {
                    if (settlementMap[buyProposal.proposalId]
                        && buyProposal.count - settlementMap[buyProposal.proposalId] > 0) {
                        buyProposal.count -= settlementMap[buyProposal.proposalId];
                        partialClosingProposals.push(buyProposal)
                    }
                })
                return proposalRegistry.updateAll(partialClosingProposals);
            })
            .then(function () {
                if (reaminingForSale > 0 ){
                    newProposal.count = reaminingForSale;
                    return proposalRegistry.add(newProposal);
                }
            })
        })
        })
    })
}

function transferOwnership(sourceTrader, destinTrader, company, count){
    return reduceShare(sourceTrader, company, count)
    .then(function(){
        return addShare(destinTrader, company, count)
    })
    .then(function(error){
        console.log('insufficient share. To be handled')
        //fix: insufficient share. To be handled
    })
}

function createTradeForProposal(proposal, proposalType, counterProposals, settlementList){
    var tradeCreatePromises = [];
    counterProposals.forEach(function(counterProposal){
        if(settlementList[counterProposal.proposalId]){
            var buyer = (proposalType == "FOR_SALE") ? counterProposal.trader : proposal.trader;
            var seller = (proposalType == "FOR_SALE") ? proposal.trader : counterProposal.trader;
            tradeCreatePromises.push(
                createTradeEntry(buyer, seller, proposal.company, settlementList[counterProposal.proposalId], counterProposal.price)
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

function reduceShare(holde, company, count){
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