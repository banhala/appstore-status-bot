const path = require("path");
const { WebClient } = require("@slack/web-api");
const { I18n } = require("i18n");

const webhookURL = process.env.SLACK_WEBHOOK;
const token = process.env.SLACK_WEB_CLIENT_API_KEY;
const language = process.env.LANGUAGE;
const CHANNEL_Q = process.env.CHANNEL_Q;
const i18n = new I18n();
const slack_web_client = new WebClient(token);

i18n.configure({
  locales: ['en', 'ko', 'ja'],
  directory: path.join(__dirname, '../locales')
});

i18n.setLocale(language);

async function post(appInfo, change_log) {
  console.log("[*] slack post");
  const message = appInfo.generated_message;
  const attachment = slackAttachment(appInfo);

  try {
    const threadTs = await client_message(message, attachment);
    if (change_log && change_log.ios_change_log) {
      await client_message(change_log.ios_change_log, null, threadTs);
    }
  } catch(error) {
    console.error("Error in posting message: ", error);
  }
}

async function client_message(message, attachment, threadTs) {
  const payload = {
    channel: CHANNEL_Q,
    text: message
  };
  if (attachment) {
    payload.attachments = [attachment]
  }
  if (threadTs) {
    payload.thread_ts = threadTs;
  }
  const response = await slack_web_client.chat.postMessage(payload);
  return response.ts;
}

function slackAttachment(appInfo) {
  const attachment = {
    fallback: `The status of your app ${appInfo.name} has been changed to ${appInfo.status}`,
    color: colorForStatus(appInfo.status),
    title: "App Store Connect",
    author_name: appInfo.name,
    author_icon: appInfo.iconURL,
    title_link: `https://appstoreconnect.apple.com/apps/${appInfo.appID}/appstore`,
    fields: [
      {
        title: i18n.__("Version"),
        value: appInfo.version,
        short: true
      },
      {
        title: i18n.__("Status"),
        value: i18n.__(appInfo.status),
        short: true
      }
    ],
    footer: "appstore-status-bot",
    footer_icon:
      "https://icons-for-free.com/iconfiles/png/512/app+store+apple+apps+game+games+store+icon-1320085881005897327.png",
    ts: new Date().getTime() / 1000,
  };
  return attachment;
}

function colorForStatus(status) {
  const infoColor = "#8e8e8e";
  const warningColor = "#f4f124";
  const successColor1 = "#1eb6fc";
  const successColor2 = "#14ba40";
  const failureColor = "#e0143d";
  const colorMapping = {
    "Prepare for Submission": infoColor,
    "Waiting For Review": infoColor,
    "In Review": successColor1,
    "Pending Contract": warningColor,
    "Waiting For Export Compliance": warningColor,
    "Pending Developer Release": successColor2,
    "Processing for App Store": successColor2,
    "Pending Apple Release": successColor2,
    "Ready for Sale": successColor2,
    "Rejected": failureColor,
    "Metadata Rejected": failureColor,
    "Removed From Sale": failureColor,
    "Developer Rejected": failureColor,
    "Developer Removed From Sale": failureColor,
    "Invalid Binary": failureColor,
  };

  return colorMapping[status];
}

module.exports = {
  post: post,
};
