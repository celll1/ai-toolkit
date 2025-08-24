import json
import os
from typing import Dict, List, Set, Tuple, Optional
from pathlib import Path
from enum import Enum

class TagNormalizationFormat(Enum):
    """タグ正規化の出力形式"""
    UNDERSCORE = "underscore"  # tag_name_(subcategory)
    SPACE = "space"  # tag name (subcategory)
    SPACE_ESCAPED = "space_escaped"  # tag name \(subcategory\)

# 人数関連タグの完全なリスト（高速判定用）
PERSON_COUNT_SIMPLE_TAGS = {
    'no_humans', 'no humans',
    'solo', 
    'group',
    'still_life', 'still life',
    'multiple_girls', 'multiple girls',
    'multiple_boys', 'multiple boys', 
    'multiple_others', 'multiple others',
    # フォーカス系タグ
    'solo_focus', 'solo focus',
    'male_focus', 'male focus',
    'other_focus', 'other focus',
    # 数字付きタグ（1-5 + 6+）をハードコード
    '1girl', '2girls', '3girls', '4girls', '5girls', '6+girls',
    '1boy', '2boys', '3boys', '4boys', '5boys', '6+boys',
    '1other', '2others', '3others', '4others', '5others', '6+others',
}

class TagGroupManager:
    def __init__(self, tag_group_dir: str = 'taggroup', 
                 normalization_format: TagNormalizationFormat = TagNormalizationFormat.SPACE_ESCAPED):
        self.tag_group_dir = tag_group_dir
        self.normalization_format = normalization_format
        self.tag_groups: Dict[str, Set[str]] = {}
        
        # 超高速キャッシュ - 最も重要
        self._tag_group_cache: Dict[str, str] = {}  # tag -> group の完全キャッシュ
        self._person_tag_cache: Dict[str, bool] = {}  # person tag判定キャッシュ
        self._normalized_tag_cache: Dict[str, str] = {}  # 正規化結果キャッシュ
        
        self.load_tag_groups()
    
    def load_tag_groups(self):
        """タググループJSONファイルを高速に読み込み、全パターンを事前生成"""
        base_path = Path(self.tag_group_dir)
        if not base_path.exists():
            return
        
        # 全JSONファイルを一括処理
        for json_file in base_path.glob('*.json'):
            group_name = json_file.stem
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                # 事前に全ての正規化パターンを生成して登録
                for original_tag in data.keys():
                    self._register_all_patterns(original_tag, group_name)
                        
            except Exception as e:
                print(f"Warning: Failed to load {json_file}: {e}")
    
    def _register_all_patterns(self, original_tag: str, group_name: str):
        """タグの全正規化パターンを事前生成してキャッシュに登録"""
        # ベース正規化
        base = original_tag.lower().strip()
        patterns = {base}
        
        # アンダースコア <-> スペース
        space_version = base.replace('_', ' ')
        patterns.add(space_version)
        
        # 括弧のエスケープパターンを生成
        if '(' in base or ')' in base:
            # エスケープ追加
            escaped = base.replace('(', '\\(').replace(')', '\\)')
            patterns.add(escaped)
            
            space_escaped = space_version.replace('(', '\\(').replace(')', '\\)')
            patterns.add(space_escaped)
            
            # 既にエスケープされている場合の除去
            if '\\(' in base or '\\)' in base:
                unescaped = base.replace('\\(', '(').replace('\\)', ')')
                patterns.add(unescaped)
                
                space_unescaped = unescaped.replace('_', ' ')
                patterns.add(space_unescaped)
        
        # 全パターンをキャッシュに登録
        for pattern in patterns:
            self._tag_group_cache[pattern] = group_name
        
        # グループセットにも追加（ベース正規化形式）
        if group_name not in self.tag_groups:
            self.tag_groups[group_name] = set()
        self.tag_groups[group_name].add(space_version)  # 標準形式で保存
    
    def get_tag_group(self, tag: str) -> str:
        """タグのグループを超高速取得（完全キャッシュ依存）"""
        # 1. そのままチェック（最高速パス）
        if tag in self._tag_group_cache:
            return self._tag_group_cache[tag]
        
        # 2. 小文字・strip済みでチェック
        normalized = tag.lower().strip()
        if normalized in self._tag_group_cache:
            # 元のタグもキャッシュに追加
            result = self._tag_group_cache[normalized]
            self._tag_group_cache[tag] = result
            return result
        
        # 3. 基本的な正規化パターンのみ試行（最小限）
        space_version = normalized.replace('_', ' ')
        if space_version in self._tag_group_cache:
            result = self._tag_group_cache[space_version]
            self._tag_group_cache[tag] = result
            self._tag_group_cache[normalized] = result
            return result
        
        underscore_version = normalized.replace(' ', '_')
        if underscore_version in self._tag_group_cache:
            result = self._tag_group_cache[underscore_version]
            self._tag_group_cache[tag] = result
            self._tag_group_cache[normalized] = result
            return result
        
        # 4. デフォルト（キャッシュに登録）
        self._tag_group_cache[tag] = 'General'
        self._tag_group_cache[normalized] = 'General'
        return 'General'
    
    def is_person_count_tag(self, tag: str) -> bool:
        """人数関連タグの超高速判定"""
        # キャッシュチェック
        if tag in self._person_tag_cache:
            return self._person_tag_cache[tag]
        
        # 正規化（一度だけ）
        normalized = tag.lower().strip()
        
        # ハードコードセットでの高速チェック
        result = (normalized in PERSON_COUNT_SIMPLE_TAGS or
                 normalized.replace('_', ' ') in PERSON_COUNT_SIMPLE_TAGS or
                 normalized.replace(' ', '_') in PERSON_COUNT_SIMPLE_TAGS or
                 normalized.endswith('_focus') or 
                 normalized.endswith(' focus'))
        
        # キャッシュに保存
        self._person_tag_cache[tag] = result
        self._person_tag_cache[normalized] = result
        
        return result
    
    def format_tag(self, tag: str) -> str:
        """指定された形式でタグをフォーマット（キャッシュ使用）"""
        cache_key = f"{tag}:{self.normalization_format.value}"
        if cache_key in self._normalized_tag_cache:
            return self._normalized_tag_cache[cache_key]
        
        if self.normalization_format == TagNormalizationFormat.UNDERSCORE:
            result = tag.replace(' ', '_')
        elif self.normalization_format == TagNormalizationFormat.SPACE:
            result = tag.replace('_', ' ')
        else:  # SPACE_ESCAPED
            result = tag.replace('_', ' ')
            # 未エスケープの括弧のみエスケープ
            if '(' in result and '\\(' not in result:
                result = result.replace('(', '\\(')
            if ')' in result and '\\)' not in result:
                result = result.replace(')', '\\)')
        
        self._normalized_tag_cache[cache_key] = result
        return result
    
    def shuffle_by_groups(self, tokens: List[str], groups_to_shuffle: List[str], 
                         keep_first_n: int = 0, exclude_person_count: bool = False,
                         shuffle_together: bool = False, rng=None) -> List[str]:
        """最適化されたシャッフル実装（バッチ処理）"""
        import random
        if rng is None:
            rng = random.Random()
        
        # 基本チェック
        if not groups_to_shuffle or not tokens or len(tokens) <= keep_first_n:
            return tokens
        
        groups_set = set(groups_to_shuffle)
        start_idx = max(0, keep_first_n)
        
        # バッチで前処理（一度だけstrip）
        working_tokens = [(i, tokens[i].strip()) for i in range(start_idx, len(tokens)) if tokens[i].strip()]
        
        if not working_tokens:
            return tokens
        
        # バッチでグループ分類（最小限の呼び出し）
        if shuffle_together:
            # 全体シャッフル用
            shuffleable_items = []
            for idx, token in working_tokens:
                group = self.get_tag_group(token)
                if group in groups_set:
                    if not (exclude_person_count and group == 'General' and self.is_person_count_tag(token)):
                        shuffleable_items.append((idx, token))
            
            if len(shuffleable_items) <= 1:
                return tokens
            
            # シャッフル実行
            indices = [item[0] for item in shuffleable_items]
            values = [self.format_tag(item[1]) for item in shuffleable_items]
            rng.shuffle(values)
            
            result = tokens[:]
            for idx, val in zip(indices, values):
                result[idx] = val
            
            return result
        else:
            # グループごとシャッフル
            group_items: Dict[str, List[Tuple[int, str]]] = {}
            
            for idx, token in working_tokens:
                group = self.get_tag_group(token)
                if group in groups_set:
                    if not (exclude_person_count and group == 'General' and self.is_person_count_tag(token)):
                        if group not in group_items:
                            group_items[group] = []
                        group_items[group].append((idx, token))
            
            if all(len(items) <= 1 for items in group_items.values()):
                return tokens
            
            # 各グループをシャッフル
            result = tokens[:]
            for group, items in group_items.items():
                if len(items) > 1:
                    indices = [item[0] for item in items]
                    values = [self.format_tag(item[1]) for item in items]
                    rng.shuffle(values)
                    for idx, val in zip(indices, values):
                        result[idx] = val
                else:
                    # シャッフルしない場合もフォーマットは適用
                    for idx, val in items:
                        result[idx] = self.format_tag(val)
            
            return result
    
    def clear_cache(self):
        """キャッシュをクリア"""
        self._tag_group_cache.clear()
        self._person_tag_cache.clear()
        self._normalized_tag_cache.clear()