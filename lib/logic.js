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
    // }
    var factory = getFactory();
    var shares = new Array();
    for (var i = 0; i < shareIssue.count; i++) {
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
        .then(function (shareRegistry) {
            return shareRegistry.addAll(shares)
                .then(function () {
                    return getParticipantRegistry('org.se.exchange.Company')
                        .then(function (companyRegistry) {
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
        var traders = {}, sellerResolvePromises = [];

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
                neededShares = proposalRequest.count,
                proposalStatus = {};
            saleProposals.forEach(function (saleProposal) {
                var proposalRemaining = proposalRequest.count - neededShares,
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
                    .then(function () {

                    });
            })
        });
        //todo : Remove satisfied proposals
    })    
}

function executeBuyProposalOld(proposalRequest, newProposal, trader, traderRegistry, shareRegistry, proposalRegistry) {
    var totalAmount = proposalRequest.count * proposalRequest.price;
    if (trader.balace < totalAmount) {
        console.log('Trader does not have enough balance')
        return // handle error
    }

    return query('selectSaleProposalOfCompany', {
        "company": proposalRequest.company.toURI(),
        "price": proposalRequest.price
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
                            owner: proposal.trader.toURI(),
                            company: proposal.company.toURI(),
                            limit: takeAway
                        })
                            .then(function (shares) {
                                console.log('Obtained prpospectus shares : ', shares.length);
                                var promisesInner = [];
                                shares.forEach(function (share) {
                                    console.log('Iterating on shares');
                                    var previousOwner = share.holder;
                                    share.holder = trader;
                                    // promisesInner.push(
                                        // shareRegistry.update(share)
                                        //     .then(function () {
                                            // function(){
                                                console.log('Share updated');
                                                previousOwner.balance += proposal.price;
                                                console.log('previous owner balance updating');
                                                trader.balance -= proposal.price;
                                                console.log('Current trader balance upating')
                                                return traderRegistry.updateAll([previousOwner, trader])
                                                    .then(function () {
                                                        console.log('Buyer and seller updated');
                                                        if (proposalRemaining <= 0) {
                                                            return proposalRegistry.remove(proposal)
                                                                .then(function () {
                                                                    console.log('Winding up');
                                                                })
                                                        }
                                                    })
                                            // }()
                                            // })
                                            // .then(function (shareUpdateError) {
                                            //     console.log('Share Update Error : ', shareUpdateError);
                                            // })
                                    // )
                                })
                                console.log('Going to wait for internal promises')
                                return Promise.all(promisesInner);
                            })
                    )
                })
            }
            return Promise.all(promisesOuter).then(function () {
                console.log('Outer Promises : Needed Shares : ', neededShares)
                if (neededShares > 0) {
                    console.log('Saving the buy propsal; Needed Shares : ', neededShares);
                    newProposal.count = neededShares;
                    proposalRegistry.add(newProposal);
                }
            })
                .then(function () {
                    console.log('Done');
                })
                .then(function (error) {
                    console.log('Error : ', error);
                })
        })
}

function executeSaleProposal(proposalRequest, newProposal, trader, traderRegistry, shareRegistry, proposalRegistry) {
    console.log("Execute Sale Proposal");
    console.log("Proposal Reqeust :", proposalRequest.toString())
    console.log('Trader : ', trader.email)
    console.log('Requesting company : ', proposalRequest.company.toString())
    console.log('Requested Count : ', proposalRequest.count)
    console.log('FullyQualifiedIdentifier : ', "resuorce:" + trader.getFullyQualifiedIdentifier())
    console.log('Trader.toURI : ', trader.toURI())
    var serializer = getSerializer();
    return query('selectShareByUserAndCompany', {
        "owner": trader.toURI(),
        "company": proposalRequest.company.toURI(),
        "limit": proposalRequest.count
    })
        .then(function (shares) {
            console.log('Shares of the trader : ', shares.length)
            if (shares.length < proposalRequest.count) {
                console.log('Trader does not have enough shares as per claim')
                return; //error has to be returned if the trader does not have enough shares as per the claim;
            }
            var promisesOuter = [];
            var remainingShares = proposalRequest.count;
            return query('selectBuyProposalOfCompany', {
                company: proposalRequest.company.toURI(),
                price: proposalRequest.price
            })
                .then(function (proposals) {
                    proposals.forEach(function (proposal) {
                        promisesOuter.push(function () {
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
                                            buyer.balance -= proposal.price;
                                            return traderRegistry.update(buyer)
                                                .then(function () {
                                                    seller.balance += proposal.price;
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
                        .then(function () {
                            if (remainingShares > 0) {
                                console.log('Saving proposal with remaining Shares..: ', remainingShares)
                                newProposal.count = remainingShares;
                                proposalRegistry.add(newProposal);
                            }
                        })
                })
        })
        .then(function (error) {
            console.log('Error caught in querying : ', error)
        })
}


