# Sendblue

Send and receive iMessages with [Sendblue](https://sendblue.com/).

Configure the API key ID and API secret in module settings. Cloud deployments poll the account for
received messages when Polling mode is selected. Paid accounts can instead select Webhook mode,
configure a signing secret, and add the generated URL to a Sendblue `receive` webhook.
