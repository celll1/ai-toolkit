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
        self.tag_to_group: Dict[str, str] = {}
        # 正規化済みタグのキャッシュ（処理済みの結果を保存）
        self._normalized_cache: Dict[str, str] = {}
        self._person_tag_cache: Dict[str, bool] = {}
        self.load_tag_groups()
    
    def load_tag_groups(self):
        """タググループJSONファイルを高速に読み込む"""
        base_path = Path(self.tag_group_dir)
        if not base_path.exists():
            return
        
        # 全JSONファイルを一括処理
        for json_file in base_path.glob('*.json'):
            group_name = json_file.stem
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # 複数の正規化パターンを登録
                    for original_tag in data.keys():
                        # 様々な正規化パターンを生成して登録
                        normalized_patterns = self._generate_normalized_patterns(original_tag)
                        for pattern in normalized_patterns:
                            self.tag_to_group[pattern] = group_name
                        
                        # グループにはベース正規化形式を保存
                        base_normalized = self._base_normalize(original_tag)
                        if group_name not in self.tag_groups:
                            self.tag_groups[group_name] = set()
                        self.tag_groups[group_name].add(base_normalized)
                        
            except Exception as e:
                print(f"Warning: Failed to load {json_file}: {e}")
    
    def _generate_normalized_patterns(self, tag: str) -> Set[str]:
        """タグから可能な全ての正規化パターンを生成"""
        patterns = set()
        
        # ベース正規化（小文字、前後の空白削除）
        base = tag.lower().strip()
        patterns.add(base)
        
        # アンダースコアをスペースに置換
        space_version = base.replace('_', ' ')
        patterns.add(space_version)
        
        # 括弧のエスケープパターン
        # tag_name_(subcategory) の場合:
        # 1. tag_name_(subcategory)
        # 2. tag name (subcategory)
        # 3. tag name \(subcategory\)
        
        if '(' in base or ')' in base:
            # エスケープされた括弧
            escaped_version = base.replace('(', '\\(').replace(')', '\\)')
            patterns.add(escaped_version)
            
            # スペース版のエスケープ
            space_escaped = space_version.replace('(', '\\(').replace(')', '\\)')
            patterns.add(space_escaped)
            
            # 既にエスケープされている場合の処理
            if '\\(' in base or '\\)' in base:
                # エスケープを除去したバージョン
                unescaped = base.replace('\\(', '(').replace('\\)', ')')
                patterns.add(unescaped)
                space_unescaped = unescaped.replace('_', ' ')
                patterns.add(space_unescaped)
        
        return patterns
    
    def _base_normalize(self, tag: str) -> str:
        """ベース正規化（内部処理用）"""
        # 小文字化、前後の空白削除、アンダースコアをスペースに
        normalized = tag.lower().strip().replace('_', ' ')
        # エスケープを除去
        normalized = normalized.replace('\\(', '(').replace('\\)', ')')
        return normalized
    
    def normalize_tag(self, tag: str) -> str:
        """タグを正規化（キャッシュ使用）"""
        if tag in self._normalized_cache:
            return self._normalized_cache[tag]
        
        normalized = self._base_normalize(tag)
        self._normalized_cache[tag] = normalized
        return normalized
    
    def get_tag_group(self, tag: str) -> str:
        """タグのグループを高速に取得"""
        # 入力タグをそのままチェック（高速パス）
        tag_lower = tag.lower().strip()
        if tag_lower in self.tag_to_group:
            return self.tag_to_group[tag_lower]
        
        # 様々な正規化パターンを試す
        patterns = self._generate_normalized_patterns(tag)
        for pattern in patterns:
            if pattern in self.tag_to_group:
                # キャッシュに登録
                self.tag_to_group[tag_lower] = self.tag_to_group[pattern]
                return self.tag_to_group[pattern]
        
        return 'General'
    
    def is_person_count_tag(self, tag: str) -> bool:
        """人数関連タグかを高速判定"""
        # 入力タグを小文字化
        tag_lower = tag.lower().strip()
        
        # キャッシュチェック
        if tag_lower in self._person_tag_cache:
            return self._person_tag_cache[tag_lower]
        
        result = False
        
        # 1. ハードコードされた人数タグの直接チェック
        if tag_lower in PERSON_COUNT_SIMPLE_TAGS:
            result = True
        else:
            # スペース/アンダースコア変換を試す
            tag_with_space = tag_lower.replace('_', ' ')
            tag_with_underscore = tag_lower.replace(' ', '_')
            
            if tag_with_space in PERSON_COUNT_SIMPLE_TAGS or tag_with_underscore in PERSON_COUNT_SIMPLE_TAGS:
                result = True
            # 2. _focus または " focus"で終わるタグ（上記でカバーされていないもの）
            elif tag_lower.endswith('_focus') or tag_lower.endswith(' focus'):
                result = True
        
        self._person_tag_cache[tag_lower] = result
        return result
    
    def format_tag(self, tag: str) -> str:
        """指定された形式でタグをフォーマット"""
        if self.normalization_format == TagNormalizationFormat.UNDERSCORE:
            # アンダースコア形式：スペースをアンダースコアに、括弧はそのまま
            return tag.replace(' ', '_')
        elif self.normalization_format == TagNormalizationFormat.SPACE:
            # スペース形式：アンダースコアをスペースに、括弧はそのまま
            return tag.replace('_', ' ')
        else:  # TagNormalizationFormat.SPACE_ESCAPED (デフォルト)
            # スペース＋エスケープ形式：アンダースコアをスペースに、括弧をエスケープ
            formatted = tag.replace('_', ' ')
            # 既にエスケープされていない括弧をエスケープ
            if '\\(' not in formatted and '\\)' not in formatted:
                formatted = formatted.replace('(', '\\(').replace(')', '\\)')
            return formatted
    
    def shuffle_by_groups(self, tokens: List[str], groups_to_shuffle: List[str], 
                         keep_first_n: int = 0, exclude_person_count: bool = False,
                         shuffle_together: bool = False, rng=None) -> List[str]:
        """最適化されたシャッフル実装"""
        import random
        if rng is None:
            rng = random.Random()
        
        # 基本チェック
        if not groups_to_shuffle or not tokens or len(tokens) <= keep_first_n:
            return tokens
        
        groups_set = set(groups_to_shuffle)
        start_idx = max(0, keep_first_n)
        
        # シャッフル対象を事前に分類
        if shuffle_together:
            # 全体シャッフル用のインデックスとトークンを収集
            shuffleable_items = []
            for idx in range(start_idx, len(tokens)):
                token = tokens[idx].strip()
                if not token:
                    continue
                
                group = self.get_tag_group(token)
                if group not in groups_set:
                    continue
                
                # Person count tagチェック（必要な場合のみ）
                if exclude_person_count and group == 'General':
                    if self.is_person_count_tag(token):
                        continue
                
                shuffleable_items.append((idx, token))
            
            if len(shuffleable_items) <= 1:
                return tokens
            
            # インデックスと値を分離してシャッフル
            indices = [item[0] for item in shuffleable_items]
            values = [item[1] for item in shuffleable_items]
            rng.shuffle(values)
            
            # 結果を構築（フォーマット適用）
            result = tokens[:]
            for idx, val in zip(indices, values):
                result[idx] = self.format_tag(val)
            
            return result
        else:
            # グループごとのシャッフル
            group_items: Dict[str, List[Tuple[int, str]]] = {}
            
            for idx in range(start_idx, len(tokens)):
                token = tokens[idx].strip()
                if not token:
                    continue
                
                group = self.get_tag_group(token)
                if group not in groups_set:
                    continue
                
                # Person count tagチェック（必要な場合のみ）
                if exclude_person_count and group == 'General':
                    if self.is_person_count_tag(token):
                        continue
                
                if group not in group_items:
                    group_items[group] = []
                group_items[group].append((idx, token))
            
            # シャッフル不要な場合は早期リターン
            if all(len(items) <= 1 for items in group_items.values()):
                return tokens
            
            # 各グループをシャッフル（フォーマット適用）
            result = tokens[:]
            for group, items in group_items.items():
                if len(items) > 1:
                    indices = [item[0] for item in items]
                    values = [item[1] for item in items]
                    rng.shuffle(values)
                    for idx, val in zip(indices, values):
                        result[idx] = self.format_tag(val)
                else:
                    # シャッフルしない場合もフォーマットは適用
                    for idx, val in items:
                        result[idx] = self.format_tag(val)
            
            return result
    
    def clear_cache(self):
        """キャッシュをクリア"""
        self._normalized_cache.clear()
        self._person_tag_cache.clear()