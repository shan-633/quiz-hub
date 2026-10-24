import { useId } from 'react';
import { stageLabels, type Curriculum } from '../../shared/curriculum';
export const emptyCurriculum: Curriculum = {
  stage: 'junior',
  subject: '',
  region: '全国',
  exam: '',
  scheme: '',
};
export function CurriculumFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Curriculum;
  onChange: (value: Curriculum) => void;
  disabled?: boolean;
}) {
  const id = useId(),
    patch = (key: keyof Curriculum, text: string) => onChange({ ...value, [key]: text });
  const suggestions = {
    subject: [
      '语文',
      '数学',
      '英语',
      '物理',
      '化学',
      '生物',
      '历史',
      '地理',
      '道德与法治',
      '政治',
      '信息技术',
      '综合',
    ],
    region: [
      '全国',
      '北京',
      '天津',
      '上海',
      '重庆',
      '河北',
      '山西',
      '辽宁',
      '吉林',
      '黑龙江',
      '江苏',
      '浙江',
      '安徽',
      '福建',
      '江西',
      '山东',
      '河南',
      '湖北',
      '湖南',
      '广东',
      '海南',
      '四川',
      '贵州',
      '云南',
      '陕西',
      '甘肃',
      '青海',
      '内蒙古',
      '广西',
      '西藏',
      '宁夏',
      '新疆',
      '香港',
      '澳门',
      '台湾',
    ],
    exam: [
      '中考',
      '高考',
      '期中',
      '期末',
      '同步练习',
      '大学英语四级',
      '大学英语六级',
      '研究生入学考试',
      '职业资格',
    ],
  };
  return (
    <fieldset className="curriculum-fields" disabled={disabled}>
      <legend>学段、学科与考试分类</legend>
      <div className="form-grid">
        <label className="field">
          学段
          <select value={value.stage} onChange={(e) => patch('stage', e.target.value)}>
            {Object.entries(stageLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {(['subject', 'region', 'exam'] as const).map((key) => (
          <label className="field" key={key}>
            {{ subject: '学科', region: '考试地区', exam: '考试名称' }[key]}
            <input
              required
              maxLength={80}
              list={id + key}
              value={value[key]}
              onChange={(e) => patch(key, e.target.value)}
              placeholder="可选择或自行填写"
            />
            <datalist id={id + key}>
              {suggestions[key].map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
        ))}
        <label className="field span-2">
          卷型 / 选科方案（可选）
          <input
            maxLength={120}
            value={value.scheme}
            onChange={(e) => patch('scheme', e.target.value)}
            placeholder="例如：2026 · 自主命题，或 3+1+2 · 物理组合"
          />
        </label>
      </div>
      <p className="muted small">
        地区、卷型与选科可随年度调整，请按这份内容实际适用的考试填写；本系统不自动推定各省考试政策。
      </p>
    </fieldset>
  );
}
