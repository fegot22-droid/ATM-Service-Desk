const RAW_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as {env?: {BASE_URL?: string}}).env?.BASE_URL) ||
  '/';
const BASE = RAW_BASE.endsWith('/') ? RAW_BASE : `${RAW_BASE}/`;

export const ERROR_CODES_URL = `${BASE}assets/aistudio/error_codes_9f400606.json`;
export const SCHEMES_URL = `${BASE}assets/aistudio/schemes_26bbeb13.json`;

export const GUIDE_SOURCES = [
  {
    id: 'ncr',
    subtitle: 'Установка ПО Aptra 04.02 / 03.04 на SelfServ',
    sourceFileName: 'NCR_Aptra.docx',
    url: `${BASE}assets/aistudio/ncr_a0303f0e.md`,
  },
  {
    id: 'cineo',
    subtitle: 'Восстановление образа и настройка ProFlex',
    sourceFileName: 'CINEO_ProFlex.docx',
    url: `${BASE}assets/aistudio/cineo_adacbd3a.md`,
  },
  {
    id: 'grg',
    subtitle: 'Настройка Windows, ключей, NeoVideo и камер',
    sourceFileName: 'GRG_nastroika.pdf',
    url: `${BASE}assets/aistudio/grg_1ebb89c6.md`,
  },
] as const;

export const SCHEME_IMAGE_URLS: Record<string, string> = {
  ccdm_sensor_1: `${BASE}assets/aistudio/ccdm_sensor_1_b867b700.jpg`,
  ccdm_sensor_2: `${BASE}assets/aistudio/ccdm_sensor_2_5579d41e.jpg`,
  ccdm_sensor_3: `${BASE}assets/aistudio/ccdm_sensor_3_76992761.jpg`,
  ccdm_sensor_4: `${BASE}assets/aistudio/ccdm_sensor_4_3d6fd48f.jpg`,
  cmd_v4_horizontal: `${BASE}assets/aistudio/cmd_v4_horizontal_61b8cc78.jpg`,
  cmd_v4_vertical: `${BASE}assets/aistudio/cmd_v4_vertical_080cfd73.jpg`,
  crm_sensor: `${BASE}assets/aistudio/crm_sensor_cc724fb2.jpg`,
  crm_motor: `${BASE}assets/aistudio/crm_motor_91d4fb68.jpg`,
  cam_sensor: `${BASE}assets/aistudio/cam_sensor_5fdfc9bd.jpg`,
  cam_motor: `${BASE}assets/aistudio/cam_motor_86708910.jpg`,
  cam_solenoid: `${BASE}assets/aistudio/cam_solenoid_2ce891df.jpg`,
  cdm_sensor: `${BASE}assets/aistudio/cdm_sensor_a2950706.jpg`,
  cdm_motor: `${BASE}assets/aistudio/cdm_motor_4dca0a0d.jpg`,
  crm_up: `${BASE}assets/aistudio/crm_up_8f222c57.jpg`,
  crm_down: `${BASE}assets/aistudio/crm_down_87dd9a7a.jpg`,
  cam_sensor_up: `${BASE}assets/aistudio/cam_sensor_up_1741d412.jpg`,
  cam_sensor_down: `${BASE}assets/aistudio/cam_sensor_down_6005216b.jpg`,
  crs_head_motors: `${BASE}assets/aistudio/crs_head_motors_dfb813f7.jpg`,
  crs_head_sensors: `${BASE}assets/aistudio/crs_head_sensors_957b4ae1.jpg`,
  crs_dm_cassette: `${BASE}assets/aistudio/crs_dm_cassette_08ff7de5.jpg`,
};

export function getSchemeImageUrl(imageId: string): string {
  return SCHEME_IMAGE_URLS[imageId] ?? '';
}
