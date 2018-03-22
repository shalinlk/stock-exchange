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
 * @param {org.se.exchange.Propose} propose
 * @transaction
 */
function onProposal(propose) {
    propose.proposal.trader = getCurrentParticipant();
    if (propose.proposal.count <= 0 || propose.proposal.company == null){
        return //todo : handle error
    }
    if (propose.proposal.proposalStatus == 'FOR_SALE'){
        return executeSaleProposal(propose)
    }
    if (propose.proposal.proposalStatus == 'FOR_BUY'){
        return executeBuyProposal(proposal)
    }
}

function executeBuyProposal(propose){
    var totalAmount = propose.proposal.count * propose.proposal.proposedPrice
    var trader =  propose.proposal.trader;
    if (trader.balace < totalAmount){
        return //handle error
    }
    return getParticipantRegistry('org.se.exchange.Trader')
    .then(function(traderRegistry){
        return getAssetRegistry('org.se.exchange.Share')
    .then(function (shareRegistry) {
        return getAssetRegistry('org.se.exchange.Proposal')
    .then(function (proposalRegistry) {
        return query('selectSaleProposalOfCompany', propose.proposal.company, propose.proposal.proposedPrice)
        //fixme : limit has to be implemented; default limit is 25
    .then(function (results) {
        var promisesOuter = [];
        var neededShares = propose.proposal.count;//var neededShare is shared among async tasks
        if (results.length >= 0) {
            results.foreach(function (proposal) {
                if(neededShares > 0){//fixme : crappy if case
                    var proposalRemaining = proposal.count - neededShares;
                    var takeAway = 0;
                    if (proposalRemaining < 0) {
                        takeAway = proposal.count;
                        neededShares = neededShares - takeAway;
                    } else if (proposalRemaining >= 0) {
                        takeAway = neededShares;
                        neededShares = 0;
                    }
                    promisesOuter.push(
                        query('selectShareByUserAndCompany', proposal.trader, proposal.company, takeAway)
                        .then(function (shares) {
                            var promisesInner = [];
                            shares.foreach(function (share) {
                                var previousOwner = share.holder;
                                share.holder = propose.proposal.trader;
                                promisesInner.push(
                                    shareRegistry.update(share)
                                    .then(function () {
                                        previousOwner.balace = previousOwner.balace + propose.proposal.proposedPrice;
                                        return traderRegistry.update(previousOwner)
                                        .then(function () {
                                            trader.balace = trader.balace - propose.proposal.proposedPrice;
                                            return traderRegistry.update(trader)
                                            .then(function(){
                                                if (proposalRemaining <= 0){
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
                }
            });
        }
        return Promise.all(promisesOuter).then(function(){
            if (neededShares > 0){
                propose.proposal.count = neededShares;
                proposalRegistry.add(propose.proposal)
            }
        })
    })
    })
    })
    })
}

function executeSaleProposal(propose){
    return getAssetRegistry('org.se.exchange.Proposal')
    .then(function(proposalRegistry){
        return getParticipantRegistry('org.se.exchange.Trader')
    .then(function (traderRegistry) {
        return getAssetRegistry('org.se.exchange.Share')
    .then(function (shareRegistry) {
        query('selectShareByUserAndCompany', propose.proposal.trader, propse.proposal.company)
    .then(function (shares) {
        if (shares.length >= propose.proposal.count) {
            var promisesOuter = [];
            var remainingShares = propose.proposal.count;
            return query('selectBuyProposalOfCompany', propose.proposal.company, propose.proposal.proposedPrice)
            then(function (proposals) {
                proposals.foreach(function (proposal) {
                    if (remainingShares > 0) {
                        var inDemand = proposal.count - propose.proposal.count;
                        var sellable = 0;
                        if (inDemand >= 0) {
                            remainingShares = 0;
                            sellable = propose.proposal.count;
                        } else if (inDemand < 0) {
                            sellable = proposal.count;
                            remainingShares = propose.proposal.count - proposal.count;
                        }
                        if (sellable > 0) {
                            var share = null;
                            for (var i = 0; i < sellable; i++) {
                                for (var j = 0; j < shares.length; j++) {
                                    share = shareRegistry.get(shares[j].shareId)
                                    if (share.holder = propose.proposal.trader) {
                                        break;
                                    }
                                }
                            }
                            if (share != null) {
                                share.holder = proposal.trader;
                                return promisesOuter.push(function () {
                                    shareRegistry.update(share)
                                    .then(function () {
                                        proposal.proposedPrice
                                        var buyer = proposal.trader;
                                        var seller = propose.proposal.trader;
                                        buyer.balace = buyer.balace = proposal.proposedPrice;
                                        return traderRegistry.update(buyer)
                                        .then(function () {
                                            seller.balace = seller.balace + proposal.proposedPrice;
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
                        }
                    }
                })
            })
            return Promise.all(promisesOuter)
                .then(function(){
                    if(remainingShares > 0){
                        propose.proposal.count = remainingShares;
                        return proposalRegistry.add(propose.proposal);
                    }
                })
        }
        //todo : error has to be thrown if the trader doesn't have enough shares as 
        //declared in the proposal
    })
    })
    })
    })
}