## Disclaimer ##
Active contribution and maintenance of Composer project has been discontinued by IBM. Online playground for testing composer solutions is also unavailable as of now. This repo has references to both :-( 

# POC - Hyperledger Fabric Composer
A bare minimum stock-exchange application written as a POC for Hyperledger Fabric Composer.

## Get it Working ##
1. Clone the repo
2. Navigate to stock-exchange folder
3. Execute ```composer archive create -t dir -n .```
4. Step 3 will create the .bna file
5. Deploy the .bna file on [online playground](https://composer-playground.mybluemix.net/login) for testing or on your peer network

## Models ##

Here are the few sample models that will be useful in playing with the business network. 

### Trader - Participant ###

```javascript
{
  "$class": "org.se.exchange.Trader",
  "balance": 10000,
  "email": "owner@abc.com",
  "name": "Owner ABC"
}
	
{
  "$class": "org.se.exchange.Trader",
  "balance": 50000,
  "email": "owner@xyz.com",
  "name": "Owner XYZ"
}

```

### Company - Participant ###

```javascript
{
  "$class": "org.se.exchange.Company",
  "issuedShareCount": 0,
  "owner": "resource:org.se.exchange.Trader#owner@abc.com",
  "email": "company@abc.com",
  "name": "ABC Corporation"
}

{
  "$class": "org.se.exchange.Company",
  "issuedShareCount": 0,
  "owner": "resource:org.se.exchange.Trader#owner@xyz.com",
  "email": "company@xyz.com",
  "name": "XYZ"
}

```

### ShareIssue - Transaction ###

```javascript
{
  "$class": "org.se.exchange.ShareIssue",
  "detail": "First Share Issue of ABC",
  "count": 3,
  "price": 10,
  "company": "resource:org.se.exchange.Company#company@abc.com"
}

{
  "$class": "org.se.exchange.ShareIssue",
  "detail": "First Share Issue of XYZ",
  "count": 3,
  "price": 10,
  "company": "resource:org.se.exchange.Company#company@xyz.com"
}

```

### Propose - Buy : Transaction ###

```javascript
{
  "$class": "org.se.exchange.Propose",
  "proposalType": "FOR_BUY",
  "count": 2,
  "price": 20,
  "company": "resource:org.se.exchange.Company#company@xyz.com"
}

```

### Propose - Sale : Transaction ###

```javascript
{
  "$class": "org.se.exchange.Propose",
  "proposalType": "FOR_SALE",
  "count": 3,
  "price": 20,
  "company": "resource:org.se.exchange.Company#company@xyz.com"
}

```

## Tail Note ##
* Take a look at ACL
* Company owner can only issue share on behalf of company
* Network Admin has only the provision to create Trader and Company
* Assets (Share, Proposal and Trade) can only be created through transactions


