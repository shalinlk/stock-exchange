'use strict';
/**
 * Company owner issueing company's share on behalf of company
 * @param {org.se.exchange.ShareIssue} shareIssue
 * @transaction
 */
function onShareIssue(shareIssue) {
    //ensure company owner is issueing the share
    var issueingUser = getCurrentParticipant()
    if (shareIssue.company.owner != issueingUser){
        //fixme : Handle error
        return
    }
    var factory = getFactory();
    var shares = new Array();
    for(var i=0; i < shareIssue.count; i++){
        var shareNumber = shareIssue.company.issuedShareCount + 1
        var shareId = shareIssue.company.shareNumber.toString + "_" + shareIssue.company.email
        //fixme : better identity for share; Company can have a company id
        var share = factory.newResource('org.se.exchange', 'Share', shareId)
        share.currentPrice = shareIssue.price
        share.company = shareIssue.company
        share.owner = shareIssue.company.owner
        //fixme : owner of issued share should be the company, not company owner
        shares.push(share)
    }

    return getAssetRegistry('org.se.exchange.Share')
        .then(function(shareRegistry) {
            return shareRegistry.addAll(shares);
        });
}