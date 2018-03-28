'use strict';
/**
 * Company owner issueing company's share on behalf of company
 * @param {org.se.exchange.ShareIssue} shareIssue
 * @transaction
 */
function onShareIssue(shareIssue) {
    var trader = getCurrentParticipant()
    // if (shareIssue.company.owner != trader){
    //     return //fixme : Handle error
    // }
    var factory = getFactory();
    var shares = new Array();
    for(var i=0; i < shareIssue.count; i++){
        var shareNumber = shareIssue.company.issuedShareCount + 1
        var shareId = shareIssue.company.issuedShareCount.toString() + "_" + shareIssue.company.email
        //fixme : better identity for share; Company can have a company id
        var share = factory.newResource('org.se.exchange', 'Share', shareId);
        share.currentPrice = shareIssue.price;
        share.company = shareIssue.company;
        share.holder = shareIssue.company.owner;
        shareIssue.company.issuedShareCount += 1;
        shares.push(share);
    }
    return getAssetRegistry('org.se.exchange.Share')
        .then(function(shareRegistry) {
            return shareRegistry.addAll(shares)
            .then(function(){
                return getParticipantRegistry('org.se.exchange.Company')
                    .then(function(companyRegistry){
                        companyRegistry.update(shareIssue.company)
                    })
            })
        });
        //todo : update company asset's number of shares issued
}

/**
 * Transaction proposal for buy or sell
 * @param {org.se.exchange.Propose} proposalRequest
 * @transaction
 */
function onProposal(proposalRequest) {
    if (proposalRequest.count <= 0 || proposalRequest.company == null){
        //todo : company has to be checked for its existance
        return;//todo : handle error
    }
    var factory = getFactory();



    var trader = getCurrentParticipant();
    if (trader.getFullyQualifiedType() !== 'org.se.exchange.Trader'){
        console.log('current participant is not trader; Exiting')        
        //todo : error has to be returned for non trading doing the trading
        return;
    }

    console.log('Current Trader : ', trader);
    var proposalId = trader.email + new Date().getTime().toString();
    var proposal = factory.newResource('org.se.exchange', 'Proposal', proposalId)
    proposal.type = proposalRequest.proposalType;
    proposal.price = proposalRequest.price;
    proposal.company = proposalRequest.company;
    proposal.trader = trader;
    return getParticipantRegistry('org.se.exchange.Trader')
    .then(function(traderRegistry){
        return getAssetRegistry('org.se.exchange.Share')
        .then(function(shareRegistry){
            return getAssetRegistry('org.se.exchange.Proposal')
            .then(function(proposalRegistry){
                if (proposalRequest.proposalType == 'FOR_SALE') {
                    return executeSaleProposal(proposalRequest, proposal, trader, traderRegistry, shareRegistry, proposalRegistry);
                }
                if (proposalRequest.proposalType == 'FOR_BUY') {
                    return executeBuyProposal(proposalRequest, proposal, trader, traderRegistry, shareRegistry, proposalRegistry);
                }
            })
        })
    })    
}

function executeBuyProposal(proposalRequest, newProposal, trader, traderRegistry, shareRegistry, proposalRegistry){
    var totalAmount = proposalRequest.count * proposalRequest.price;
    if (trader.balace < totalAmount) {
        return // handle error
    }

    return query('selectSaleProposalOfCompany', {
        "company": proposalRequest.company.toString(),
        "price": 10
    })
    .then(function (results) {
        var promisesOuter = [];
        var neededShares = proposalRequest.count;//fix : shared variable among async tasks
        console.log('Results : ', results)
        if (results.length >= 0) {
            results.forEach(function (proposal) {
                var proposalRemaining = proposalRequest.count - neededShares;
                var takeAway = 0;
                if (proposalRemaining < 0) {
                    takeAway = proposal.count;
                    neededShares = neededShares - takeAway;
                } else {
                    takeAway = neededShares;
                    neededShares = 0;
                }
                promisesOuter.push(
                    query('selectShareByUserAndCompany', {
                        owner: proposal.trader, 
                        company: proposal.company.toString(),
                        limit: takeAway
                    })
                        .then(function (shares) {
                            var promisesInner = [];
                            shares.forEach(function (share) {
                                var previousOwner = share.holder;
                                share.holder = trader;
                                promisesInner.push(
                                    shareRegistry.update(share)
                                        .then(function () {
                                            previousOwner.balace += proposal.price;
                                            return traderRegistry.update(previousOwner)
                                                .then(function () {
                                                    trader.balace -= proposal.price;
                                                    //fix : concurrency issue in above line
                                                    return traderRegistry.update(trader)
                                                        .then(function () {
                                                            if (proposalRemaining <= 0) {
                                                                return proposalRegistry.remove(proposal);
                                                            }
                                                        })
                                                })
                                        })
                                )
                            })
                            return Promise.all(promisesInner);
                        })
                )
            })
        }
        return Promise.all(promisesOuter).then(function () {
            if (neededShares > 0) {
                console.log('Saving the buy propsal; Needed Shares : ', neededShares);
                newProposal.count = neededShares;
                proposalRegistry.add(newProposal);
            }
        })
    })
}

function executeSaleProposalOld(proposalRequest, newProposal, trader, traderRegistry, shareRegistry, proposalRegistry){
    return query('selectShareByUserAndCompany', {
        owner: proposalRequest.trader.toString(), 
        company: proposalRequest.company.toString(),
        limt: proposalRequest.count
    })
    .then(function(shares){
        if(shares.length < proposalRequest.count){
            return; //error has to be returned if the trader does not have enough shares as per the claim;
        }
        var promisesOuter = [];
        var remainingShares = proposalRequest.count;
        return query('selectBuyProposalOfCompany', {
            company: proposalRequest.company.toString(),
            price: proposalRequest.price
        })
        .then(function(proposals){
            proposals.forEach(function(proposal){
                promisesOuter.push(function(){
                    if (remainingShares <= 0) {//concurrent access; needs to be fixed
                        return;//to be handled
                    }
                    var inDemand = proposal.count - proposalRequest.count;
                    var sellable = 0;
                    if (inDemand >= 0) {
                        remainingShares = 0;
                        sellable = proposalRequest.count;
                    } else {
                        sellable = proposal.count;
                        remainingShares = proposalRequest.count - proposal.count;
                    }
                    var promisesInner = [];
                    for (var i = 0; i < sellable; i++) {
                        var share = null;
                        for (var j = 0; j < shares.length; j++) {
                            if (share.holder == trader) {
                                //todo : synchronous access issue
                                share = shareRegistry.get(shares[i].shareId);
                                break;
                            }
                        }
                        if (share == null) {
                            break;
                        }
                        share.holder = proposal.trader;
                        promisesInner.push(function () {
                            shareRegistry.update(share)
                                .then(function () {
                                    var buyer = proposal.trader;
                                    var seller = proposalRequest.trader;
                                    buyer.balace -= proposal.price;
                                    return traderRegistry.update(buyer)
                                        .then(function () {
                                            seller.balace += proposal.price;
                                            return traderRegistry.update(seller)
                                                .then(function () {
                                                    if (inDemand <= 0) {
                                                        return proposalRegistry.remove(proposal);
                                                    }
                                                })
                                        })
                                })
                        })
                    }
                    return Promise.all(promisesInner);
                })
            })
            return Promise.all(promisesOuter)
                .then(function(){
                    if(remainingShares > 0){
                        newProposal.count = remainingShares;
                        return proposalRegistry.add(newProposal);
                    }
                })
        })
    })
}


