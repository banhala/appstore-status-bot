const slack = require("./slack.js");
const exec = require("child_process").exec;
const { Octokit, App } = require("octokit");
const request = require("request-promise-native");
const env = Object.create(process.env);
const octokit = new Octokit({ auth: `token ${process.env.GH_TOKEN}` });
const ABLY_CHANGE_LOG_GIST_ID = process.env.ABLY_CHANGE_LOG_GIST_ID;
const O_ID = process.env.GROUP_ID_P;
const CHANNEL_R = process.env.CHANNEL_R;
const CHANNEL_Q = process.env.CHANNEL_Q;

const main = async () => {
  var existGist = await getGist(process.env.GIST_ID);

  exec(
    "ruby Sources/fetch_app_status.rb",
    { env: env },
    function (_, app, stderr) {
      if (app) {
        var parsed_app = JSON.parse(app);
        var parsed_gist = JSON.parse(existGist);

        checkVersion(parsed_app, parsed_gist);
      } else {
        console.log("There was a problem fetching the status of the app!");
        console.log(stderr);
      }
    }
  );
};

const checkVersion = async (app, gist) => {
  console.log("[*] checkVersion");
  var app = app[0];

  app["submission_start_date"] = gist.submission_start_date;

  if (!app.app_store_version_phased_release) {
    var currentDay = 0
    var phased_release_state = "NOT_EXIST"
  } else {
    var currentDay = app.app_store_version_phased_release.current_day_number
    var phased_release_state = app.app_store_version_phased_release.phased_release_state
  }

  if (!gist.app_store_version_phased_release) {
    var gist_currentDay = 0
    var gist_phased_release_state = "NOT_EXIST"
  } else {
    var gist_currentDay = gist.app_store_version_phased_release.current_day_number
    var gist_phased_release_state = gist.app_store_version_phased_release.phased_release_state
  }
  
  var isEqualPhasesState = phased_release_state == gist_phased_release_state
  var isEqualPhasesDay = currentDay == gist_currentDay
  var generated_message = generateMessage(currentDay, phased_release_state, app.status)
  app["generated_message"] = `<!subteam^S01DBJMNK4P> <!subteam^S03TPMY9EKH> <!subteam^${O_ID}> 애플 심사 상태: ` + generated_message

  if (!app.appID || !isEqualPhasesState || app.status != gist.status || (!isEqualPhasesDay && phased_release_state == "ACTIVE" && app.status == "Ready for sale")) {
    console.log("[*] status is different");

    var submission_start_date = gist.submission_start_date
    if (!submission_start_date) {
      submission_start_date = new Date();
    }
    const change_log = await getGist(ABLY_CHANGE_LOG_GIST_ID);
    const parsed_change_log = JSON.parse(change_log);
    slack.post(CHANNEL_R, app, parsed_change_log);
    if (app.status == "Waiting for review") {
      app["submission_start_date"] = new Date();
    }
  } else {
    console.log("[*] status is same");
  }

  await updateGist(app);
};
const generateMessage = (currentDay, phased_release_state, status) => {
  if (status == "Prepare for submission") {
    return "제출 준비 중입니다."
  }
  if (status == "Ready for review") {
    return "심사 준비됨으로 상태가 변경되었습니다."
  }
  if (status == "Waiting for review") {
    return "심사 대기 중입니다."
  }
  if (status == "In review") {
    return "심사 중입니다."
  }
  if (status == "Pending contract") {
    return "대기 중인 계약입니다."
  }
  if (status == "Waiting for export compliance") {
    return "수출 규정 관련 문서 승인 대기중입니다."
  }
  if (status == "Pending developer release") {
    return "개발자 출시 대기 중입니다."
  }
  if (status == "Processing for app store") {
    return "App Store 판매 준비중입니다."
  }
  if (status == "Pending apple release") {
    return "앱 승인 대기 중입니다."
  }
  if (status == "Rejected") {
    return "앱 승인이 거부되었습니다."
  }
  if (status == "Metadata rejected") {
    return "메타데이터가 거부되었습니다."
  }
  if (status == "Removed from sale") {
    return "판매가 중단되었습니다."
  }
  if (status == "Developer rejected") {
    return "개발자가 취소했습니다."
  }
  if (status == "Developer removed from sale") {
    return "개발자가 판매를 중단했습니다."
  }
  if (status == "Invalid binary") {
    return "유효하지 않은 바이너리로 인해 거절되었습니다."
  }
  if (status != "Ready for sale") {
    return "점진적 배포가 완료되었습니다. (배포 진행율 100%)"
  }
  if (phased_release_state == "COMPLETE") {
    return "점진적 배포가 완료되었습니다. (배포 진행율 100%)"
  }
  if (phased_release_state == "PAUSED") {
     return "점진적 배포가 중단되었습니다."
  }
  if (phased_release_state != "ACTIVE") {
    return "배포가 완료되었습니다. (100% 배포)."
  }
  if (phased_release_state == "NOT_EXIST" || !(phased_release_state)) {
    return "배포가 완료되었습니다. (배포 진행율 100%)"
  }
  if (currentDay == 1) {
    return "점진적 배포가 1%로 진행 중입니다."
  }
  if (currentDay == 2) {
    return "점진적 배포가 2%로 진행 중입니다."
  }
  if (currentDay == 3) {
    return "점진적 배포가 5%로 진행 중입니다."
  }
  if (currentDay == 4) {
    return "점진적 배포가 10%로 진행 중입니다."
  }
  if (currentDay == 5) {
    return "점진적 배포가 20%로 진행 중입니다."
  }
  if (currentDay == 6) {
    return "점진적 배포가 50%로 진행 중입니다."
  }
  if (currentDay == 7) {
    return "점진적 배포가 100%로 진행 중입니다."
  }
  return "점진적 배포가 완료되었습니다. (배포 진행율 100%)"
};

const calculatePercentage = (currentDay, phased_release_state, status) => {
  if (status != "Ready for sale") {
    return "Before Deployment"
  }
  if (phased_release_state == "COMPLETE") {
    return "Gradual deployment completed"
  }
  if (phased_release_state == "PAUSED") {
     return "Progressive deployment disruption"
  }
  if (phased_release_state != "ACTIVE") {
    return "Progressive deployment not in progress"
  }
  if (currentDay == 1) {
    return "1%"
  }
  if (currentDay == 2) {
    return "2%"
  }
  if (currentDay == 3) {
    return "5%"
  }
  if (currentDay == 4) {
    return "10%"
  }
  if (currentDay == 5) {
    return "20%"
  }
  if (currentDay == 6) {
    return "50%"
  }
  if (currentDay == 7) {
    return "100%"
  }
  return "Progressive deployment not in progress"
};

const getGist = async (gist_id) => {
  const gist = await octokit.rest.gists
    .get({
      gist_id: gist_id,
    })
    .catch((error) => console.error(`[*] Unable to update gist\n${error}`));
  if (!gist) return;

  const filename = Object.keys(gist.data.files)[0];
  const rawdataURL = gist.data.files[filename].raw_url;

  const options = {
    url: rawdataURL,
  };

  return await request.get(options)
};

const updateGist = async (content) => {
  console.log("[*] updateGist");

  const gist = await octokit.rest.gists
    .get({
      gist_id: process.env.GIST_ID,
    })
    .catch((error) => console.error(`[*] Unable to update gist\n${error}`));
  if (!gist) return;

  const filename = Object.keys(gist.data.files)[0];
  await octokit.rest.gists.update({
    gist_id: process.env.GIST_ID,
    files: {
      [filename]: {
        content: JSON.stringify(content),
      },
    },
  });
};

main();
