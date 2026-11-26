/*
 * 응답 기록 설정 파일
 * 이 파일만 메모장으로 열어 수정한 뒤 다시 업로드하면 됩니다.
 */
window.GM_RECORD_CONFIG = {
  // 구글 Apps Script 웹 앱 주소 (https://script.google.com/macros/s/...../exec)
  // 비워 두면 기록은 스탠바이미 안에만 쌓였다가, 주소를 넣고 다시 올리면 그때 한꺼번에 전송됩니다.
  endpoint: "https://script.google.com/macros/s/AKfycbyj1BTePUxhxWOrxfK6mbPGDeUasI3MQuEXnvK0DN7xPATb0v_9MV-ku_ka7JpzU-prQA/exec",

  // 키오스크 이름 (스프레드시트의 '키오스크' 열에 기록됨)
  // 여러 대를 쓸 때는 각 기기에서 주소 끝에 ?kiosk=이름 을 붙여 한 번 열면 그 기기에 따로 저장됩니다.
  //   예) https://내주소/data?kiosk=스탠바이미2
  kioskName: "스탠바이미",

  // 원래 앱이 하던 Firebase(dataMileResponsesOps) 저장도 계속할지 여부 (true / false)
  originalFirebase: true
};
