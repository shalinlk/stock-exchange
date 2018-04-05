'use strict';
/**
 * Company owner issueing company's share on behalf of company
 * @param {org.se.exchange.ShareIssue} shareIssue
 * @transaction
 */
function onShareIssue(shareIssue) {
    var trader = getCurrentParticipant()
    // if (shareIssue.company.owner != trader){
    //     console.log('Only company owner can share issue of the company')
    //     return //fixme : Handle error
        //  // has to be addressed by ACL
    // }
    var factory = getFactory(),
        shares = new Array(),
        issuedShares = 0;
    
    return getParticipantRegistry('org.se.exchange.Company')
        .then(function (companyRegistry){
        return companyRegistry.get(shareIssue.company.getIdentifier())
            .then(function (issueingCompany) {
                issuedShares = issueingCompany.issuedShareCount;
                for (var i = 0; i < shareIssue.count; i++) {
                    var shareId = (issuedShares + 1).toString() + "_" + shareIssue.company.email
                    //fixme : better identity for share; Company can have a company id
                    var share = factory.newResource('org.se.exchange', 'Share', shareId);
                    share.currentPrice = shareIssue.price;
                    share.company = shareIssue.company;
                    share.holder = shareIssue.company.owner;
                    issuedShares++;
                    shares.push(share);
                }
                return getAssetRegistry('org.se.exchange.Share')
                    .then(function (shareRegistry) {
                        return shareRegistry.addAll(shares)
                    })
                    .then(function () {
                        issueingCompany.issuedShareCount = issuedShares;
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

function executeBuyOrder(proposalRequest, newProposal, trader, traderRegistry, shareRegistry, proposalRegistry){
    var totalAmount = proposalRequest.count * proposalRequest.price;
    if (trader.balance < totalAmount) {
        console.log('trader does not have enough balance');
        return; //error has to be thrown
    }
    return query('selectSaleProposalOfCompany', {
        "company": proposalRequest.company.toURI(),
        "price": proposalRequest.price//limit has to be provided
    })
    .then(function(saleProposals){
        console.log('Sale Proposals Obtained; Length : ', saleProposals.length)
        var traders = {}, sellerResolvePromises = [], proposalStatus = {};
        
        saleProposals.forEach(function(saleProposal){
            sellerResolvePromises.push(
                traderRegistry.get(saleProposal.trader.getIdentifier())
                    .then(function (seller) {
                        traders[saleProposal.trader.email] = seller;
                    })
            )
        })
        return Promise.all(sellerResolvePromises)
        .then(function(){
            var sharesToBeTransfered = {},
                promisesOuter = [],
                neededShares = proposalRequest.count;
            saleProposals.forEach(function (saleProposal) {
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
                    query('selectShareByUserAndCompany', {
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
            .then(function(){
                var propRemovalPromises =[];
                for(var proposalId in proposalStatus){
                    if (proposalStatus[proposalId] <= 0){
                        propRemovalPromises.push(
                            proposalRegistry.remove(proposalId)
                        )
                    }
                }
                return Promise.all(propRemovalPromises);
            })
            .then(function(){
                var propsToBeModified = [];
                saleProposals.forEach(function(saleProposal){
                    if(proposalStatus[saleProposal.proposalId] > 0 ){
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
    return query('selectShareByUserAndCompany', {
        "owner": seller.toURI(),
        "company": proposalRequest.company.toURI(),
        "limit": proposalRequest.count
    })
    .then(function(tradingShares){
        if (tradingShares.length < proposalRequest.count) {
            console.log('Trader does not have enough shares as per claim')
            return; //error has to be returned if the trader does not have enough shares as per the claim;
        }
        var remainingShares = proposalRequest.count,
            fullfillingList = {};
        return query('selectBuyProposalOfCompany', { //Fix : has to be in ascending order of price
            company: proposalRequest.company.toURI(),
            price: proposalRequest.price
        })
        .then(function(buyProposals){
            console.log('Resolving buyers');
            var buyers = {}, buyerResolvingPromises = [];
            buyProposals.forEach(function(buyProposal){
                buyerResolvingPromises.push(
                    traderRegistry.get(buyProposal.trader.getIdentifier())
                    .then(function(buyer){
                        buyers[buyProposal.trader.getIdentifier()] = buyer;
                    })
                )
            })
        return Promise.all(buyerResolvingPromises)
        .then(function(){
            var shareIndex = 0, 
                closingProposals = [], 
                partialPurchaseProposal = "", 
                partialPurchaseRemainingCount =0;
            console.log('Resolving buy proposals')
            buyProposals.forEach(function (buyProposal) {
                var inDemand = buyProposal.count - remainingShares,
                    sellable = 0;
                if (remainingShares > 0) {
                    if (inDemand > 0) {
                        sellable = remainingShares;
                        remainingShares = 0;
                        partialPurchaseProposal = buyProposal;
                        partialPurchaseRemainingCount = buyProposal.count - sellable;
                    } else {
                        sellable = buyProposal.count;
                        remainingShares -= sellable;
                        closingProposals.push(buyProposal);
                    }
                }
                fullfillingList[buyProposal.proposalId] = sellable;
                for (var i = 0; i < sellable; i++ , shareIndex++) {
                    tradingShares[shareIndex].holder = buyProposal.trader;
                }
                var amount = buyProposal.price * sellable;
                buyers[buyProposal.trader.getIdentifier()].balance -= amount;
                seller.balance += amount;
            });
            return shareRegistry.updateAll(tradingShares)
            .then(function () {
                console.log('Shares shifted')
                var traderList = [];
                for (var i in buyers){
                    traderList.push(buyers[i]);
                }
                traderList.push(seller);
                return traderRegistry.updateAll(traderList);
            })
            .then(function(){
                console.log("traders updated")
                var closingPromises = [];
                closingProposals.forEach(function(closingProposal){
                    closingPromises.push(
                        proposalRegistry.remove(closingProposal)
                    )
                })
                return Promise.all(closingPromises);
            })
            .then(function () {
                if (remainingShares > 0 ){
                    console.log('Saving the sale order for remaining shares')
                    newProposal.count = remainingShares;
                    return proposalRegistry.add(newProposal);
                } else if (partialPurchaseRemainingCount > 0){
                    console.log('Updating the partially fulfilled order')
                    partialPurchaseProposal.count = partialPurchaseRemainingCount;
                    return proposalRegistry.update(partialPurchaseProposal)
                }
            })
        })
        })
    })
}

