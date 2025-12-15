# Public Github Workflows

## Use workflows in a new WP connect plugin
Requirements:
- create a new public repository on Github (wpconnect-co account)
- add .github/workflows folder to the plugin
- add a new yml file in the folder (see template below)
- create environment and add secrets / variables in the repository settings (see details below)
- make sure changelog is hosted in changelog.txt and not in readme.txt

### To deploy plugin on WordPress.org
#### Workflow templates
```yaml
name: { plugin's name } ~ Auto Tag, release and deploy

on:
  pull_request:
    types:
      - closed

jobs:
  auto-tag-and-release:
    if: github.event.pull_request.merged == true && 'main' == github.event.pull_request.base.ref && startsWith(github.event.pull_request.head.ref, 'release/')
    uses: wpconnect-co/public-github-workflows/.github/workflows/auto-tag-and-release.yml@v1.4
    permissions:
      contents: write
    with:
      environment: { plugin's environment name }

  deploy:
    uses: wpconnect-co/public-github-workflows/.github/workflows/deploy-to-wordpress.yml@v1.4
    needs: auto-tag-and-release
    secrets: inherit
    with:
      WPC_VERSION: ${{ needs.auto-tag-and-release.outputs.version }}
      environment: { plugin's environment name }
      dry-run: false
```
Replace { plugin's name } and { plugin's environment name } with the correct values.
e.g "{ plugin's name }" => "Notion WP Sync", "{ plugin's environment name }" => "Prod"

Set dry-run to true to test the deployment without publishing the plugin on WordPress.org.
You will see SVN result in the Github job "deploy" logs.

#### Environment variables / secrets
Navigate to https://github.com/wpconnect-co/{ repo slug }/settings/secrets/actions
Click "Manage environment", then "New environment" and add the following variables:

- WPC_PLUGIN_NAME: the plugin's name (e.g "WP Sync for Notion")
- WPC_PLUGIN_SLUG: the plugin's slug (e.g "wp-sync-for-notion")
- SLACK_NOTIFICATION_CHANNEL_ID: the Slack channel id to send notifications to (e.g "C05FHPDGC13")

The secrets below are used by the workflows and are already set at the organization level:
- SVN_PASSWORD & SVN_USERNAME: allows to update the plugin on WordPress.org plugin repository
- SLACK_BOT_TOKEN: allows to send notifications to Slack
