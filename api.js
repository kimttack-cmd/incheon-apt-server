const axios = require('axios');
const xml2js = require('xml2js');

const parser = new xml2js.Parser({ explicitArray: false });
const parseXML = (xml) => parser.parseStringPromise(xml);

// ── 국토부 아파트 매매 실거래가 조회 ──────────────────────────
async function fetchSale(serviceKey, lawdCd, dealYmd) {
  const url = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
  try {
    const res = await axios.get(url, {
      params: { serviceKey, LAWD_CD: lawdCd, DEAL_YMD: dealYmd, numOfRows: 1000, pageNo: 1 },
      timeout: 15000,
    });
    const parsed = await parseXML(res.data);
    const items = parsed?.response?.body?.items?.item;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map(d => ({
      type: '매매',
      아파트: d['아파트']?.trim() || '',
      법정동: d['법정동']?.trim() || '',
      지번: d['지번']?.trim() || '',
      전용면적: parseFloat(d['전용면적']) || 0,
      거래금액: parseInt((d['거래금액'] || '0').replace(/,/g, '')) || 0,
      층: parseInt(d['층']) || 0,
      건축년도: parseInt(d['건축년도']) || 0,
      년: parseInt(d['년']) || 0,
      월: parseInt(d['월']) || 0,
      일: parseInt(d['일']) || 0,
      거래일: `${d['년']}-${String(d['월']).padStart(2,'0')}-${String(d['일']).padStart(2,'0')}`,
      등록일: d['등록일']?.trim() || '',
      해제여부: d['해제여부']?.trim() || '',
    }));
  } catch(e) {
    console.error(`[매매 API 오류] ${lawdCd} ${dealYmd}:`, e.message);
    return [];
  }
}

// ── 국토부 아파트 전월세 조회 ──────────────────────────────────
async function fetchRent(serviceKey, lawdCd, dealYmd) {
  const url = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
  try {
    const res = await axios.get(url, {
      params: { serviceKey, LAWD_CD: lawdCd, DEAL_YMD: dealYmd, numOfRows: 1000, pageNo: 1 },
      timeout: 15000,
    });
    const parsed = await parseXML(res.data);
    const items = parsed?.response?.body?.items?.item;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map(d => ({
      type: parseInt(d['월세금액']) > 0 ? '월세' : '전세',
      아파트: d['아파트']?.trim() || '',
      법정동: d['법정동']?.trim() || '',
      지번: d['지번']?.trim() || '',
      전용면적: parseFloat(d['전용면적']) || 0,
      보증금액: parseInt((d['보증금액'] || '0').replace(/,/g, '')) || 0,
      월세금액: parseInt((d['월세금액'] || '0').replace(/,/g, '')) || 0,
      층: parseInt(d['층']) || 0,
      건축년도: parseInt(d['건축년도']) || 0,
      년: parseInt(d['년']) || 0,
      월: parseInt(d['월']) || 0,
      일: parseInt(d['일']) || 0,
      거래일: `${d['년']}-${String(d['월']).padStart(2,'0')}-${String(d['일']).padStart(2,'0')}`,
      등록일: d['등록일']?.trim() || '',
    }));
  } catch(e) {
    console.error(`[전월세 API 오류] ${lawdCd} ${dealYmd}:`, e.message);
    return [];
  }
}

// ── 건축물대장 표제부 조회 (세대수, 준공일 등) ──────────────────
async function fetchBuildingInfo(serviceKey, sigunguCd, bjdongCd, bun, ji) {
  const url = 'http://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
  try {
    const res = await axios.get(url, {
      params: {
        serviceKey,
        sigunguCd,   // 시군구코드 5자리
        bjdongCd,    // 법정동코드 5자리
        bun: bun || '0000',
        ji:  ji  || '0000',
        numOfRows: 10,
        pageNo: 1,
        _type: 'json',
      },
      timeout: 15000,
    });
    const items = res.data?.response?.body?.items?.item;
    if (!items) return null;
    const arr = Array.isArray(items) ? items : [items];
    // 아파트(다세대 제외) 필터
    const apt = arr.find(b => b.mainPurpsCdNm?.includes('아파트')) || arr[0];
    if (!apt) return null;
    return {
      세대수: parseInt(apt.hhldCnt) || 0,
      동수: parseInt(apt.dongCnt) || 0,
      준공일: apt.useAprDay || '',
      건물명: apt.bldNm || '',
      주소: apt.platPlc || '',
    };
  } catch(e) {
    console.error(`[건축물대장 API 오류]:`, e.message);
    return null;
  }
}

module.exports = { fetchSale, fetchRent, fetchBuildingInfo };
