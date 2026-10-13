# Sendblue

Send and receive iMessages with [Sendblue](https://sendblue.com/).

Configure the API key ID and API secret in module settings. Cloud deployments poll the account for
received messages on plans without webhooks. Paid accounts can optionally configure a webhook
signing secret and add the generated URL to a Sendblue `receive` webhook.
