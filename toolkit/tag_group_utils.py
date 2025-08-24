import json
import os
import re
import numpy as np
from typing import Dict, List, Set, Tuple, Optional, Union
from pathlib import Path
from functools import lru_cache

# Person count tag patterns
PERSON_COUNT_TAG_PATTERNS = [
    re.compile(r"^\d+girls?$"),
    re.compile(r"^\d+boys?$"),
    re.compile(r"^\d+others?$"),
    re.compile(r"^no_humans$"),
    re.compile(r"^multiple_girls$"),
    re.compile(r"^multiple_boys$"),
    re.compile(r"^multiple_others$"),
    re.compile(r"^group$"),  # group tag is also person-related
    re.compile(r"^solo$"),   # solo is also person-related
    re.compile(r"^.*_focus$"),  # any *_focus tag (solo_focus, male_focus, etc.)
    re.compile(r"^still_life$")  # still_life is also person-related
]


# 高速化のため、よく使われるパターンをプリコンパイル
SIMPLE_PERSON_PATTERNS = {
    'no_humans', 'multiple_girls', 'multiple_boys', 
    'multiple_others', 'group', 'solo', 'still_life'
}

class TagGroupManager:
    def __init__(self, tag_group_dir: str = 'taggroup'):
        self.tag_group_dir = tag_group_dir
        self.tag_groups: Dict[str, Set[str]] = {}
        self.tag_to_group: Dict[str, str] = {}
        self._loaded = False
        # キャッシュ
        self._person_count_cache: Dict[str, bool] = {}
        self._stripped_cache: Dict[str, str] = {}
        # グループ名のインデックスマッピング（NumPy用）
        self._group_to_idx: Dict[str, int] = {}
        self._idx_to_group: Dict[int, str] = {}
        self.load_tag_groups()
    
    def load_tag_groups(self):
        """Load all tag group JSON files from the specified directory"""
        if self._loaded:
            return  # Already loaded, skip
        
        base_path = Path(self.tag_group_dir)
        if not base_path.exists():
            self._loaded = True
            return
        
        # 一括でJSONファイルを読み込む
        json_files = list(base_path.glob('*.json'))
        
        # バッチ処理で高速化
        all_tags = {}
        for json_file in json_files:
            group_name = json_file.stem
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.tag_groups[group_name] = set(data.keys())
                    for tag in data.keys():
                        all_tags[tag] = group_name
            except Exception as e:
                print(f"Warning: Failed to load tag group {json_file}: {e}")
        
        # 一括更新
        self.tag_to_group = all_tags
        
        # グループインデックスの作成
        unique_groups = list(set(all_tags.values()))
        unique_groups.append('General')  # デフォルトグループ
        self._group_to_idx = {g: i for i, g in enumerate(unique_groups)}
        self._idx_to_group = {i: g for g, i in self._group_to_idx.items()}
        
        self._loaded = True
    
    @lru_cache(maxsize=2048)
    def _strip_cached(self, tag: str) -> str:
        """文字列のstrip操作をキャッシュ"""
        return tag.strip()
    
    @lru_cache(maxsize=2048)
    def get_tag_group(self, tag: str) -> str:
        """Get the group name for a given tag"""
        tag = self._strip_cached(tag)
        return self.tag_to_group.get(tag, 'General')
    
    def is_person_count_tag(self, tag: str) -> bool:
        """Check if a tag is a person count related tag"""
        tag = self._strip_cached(tag)
        
        # キャッシュチェック
        if tag in self._person_count_cache:
            return self._person_count_cache[tag]
        
        # 高速チェック: シンプルなパターン
        if tag in SIMPLE_PERSON_PATTERNS:
            self._person_count_cache[tag] = True
            return True
        
        # 数字で始まるパターンの高速チェック
        if tag and tag[0].isdigit():
            if tag.endswith('girl') or tag.endswith('girls') or \
               tag.endswith('boy') or tag.endswith('boys') or \
               tag.endswith('other') or tag.endswith('others'):
                self._person_count_cache[tag] = True
                return True
        
        # focus系の高速チェック
        if tag.endswith('_focus'):
            self._person_count_cache[tag] = True
            return True
        
        # それ以外は正規表現でチェック（最後の手段）
        result = any(pattern.match(tag) for pattern in PERSON_COUNT_TAG_PATTERNS)
        self._person_count_cache[tag] = result
        return result
    
    def classify_tokens(self, tokens: List[str]) -> Dict[str, List[Tuple[int, str]]]:
        """
        Classify tokens by their group and return a dictionary with group names as keys
        and lists of (original_index, token) tuples as values
        """
        classified = {}
        for idx, token in enumerate(tokens):
            token = token.strip()
            if token:  # Skip empty tokens
                group = self.get_tag_group(token)
                if group not in classified:
                    classified[group] = []
                classified[group].append((idx, token))
        return classified
    
    def shuffle_by_groups_numpy(self, tokens: List[str], groups_to_shuffle: List[str], 
                               keep_first_n: int = 0, exclude_person_count: bool = False,
                               shuffle_together: bool = False, rng=None) -> List[str]:
        """
        NumPyを使用した高速シャッフル実装
        """
        import random
        if rng is None:
            rng = random.Random()
            np_rng = np.random.default_rng(rng.randint(0, 2**32-1))
        else:
            np_rng = np.random.default_rng(rng.randint(0, 2**32-1))
        
        # 基本チェック
        if not groups_to_shuffle or not tokens or len(tokens) <= keep_first_n:
            return tokens
        
        n_tokens = len(tokens)
        start_idx = max(0, keep_first_n)
        
        # NumPy配列に変換（効率的な操作のため）
        token_array = np.array(tokens, dtype=object)
        
        # シャッフル対象のインデックスを収集
        groups_set = set(groups_to_shuffle)
        shuffleable_indices = []
        
        # ベクトル化された処理
        for idx in range(start_idx, n_tokens):
            token = self._strip_cached(tokens[idx])
            if not token:
                continue
            
            group = self.get_tag_group(token)
            if group not in groups_set:
                continue
            
            # Person count tagのチェック
            if exclude_person_count and group == 'General' and self.is_person_count_tag(token):
                continue
            
            shuffleable_indices.append(idx)
        
        # シャッフル対象がない場合
        if len(shuffleable_indices) <= 1:
            return tokens
        
        # NumPy配列でインデックス操作
        shuffleable_indices = np.array(shuffleable_indices)
        
        if shuffle_together:
            # 全体をシャッフル
            shuffled_indices = shuffleable_indices.copy()
            np_rng.shuffle(shuffled_indices)
            token_array[shuffleable_indices] = token_array[shuffled_indices]
        else:
            # グループごとにシャッフル
            # グループごとにインデックスを分類
            group_indices = {}
            for idx in shuffleable_indices:
                token = self._strip_cached(tokens[idx])
                group = self.get_tag_group(token)
                if group not in group_indices:
                    group_indices[group] = []
                group_indices[group].append(idx)
            
            # 各グループをシャッフル
            for group, indices in group_indices.items():
                if len(indices) > 1:
                    indices_array = np.array(indices)
                    shuffled = indices_array.copy()
                    np_rng.shuffle(shuffled)
                    token_array[indices_array] = token_array[shuffled]
        
        return token_array.tolist()
    
    def shuffle_by_groups(self, tokens: List[str], groups_to_shuffle: List[str], 
                         keep_first_n: int = 0, exclude_person_count: bool = False,
                         shuffle_together: bool = False, rng=None) -> List[str]:
        """
        高速化されたシャッフル実装（NumPyが利用可能な場合はそちらを使用）
        """
        try:
            # NumPyが利用可能ならNumPy版を使用
            return self.shuffle_by_groups_numpy(tokens, groups_to_shuffle, 
                                              keep_first_n, exclude_person_count,
                                              shuffle_together, rng)
        except:
            # NumPyが使えない場合は従来の実装
            return self._shuffle_by_groups_fallback(tokens, groups_to_shuffle,
                                                   keep_first_n, exclude_person_count,
                                                   shuffle_together, rng)
    
    def _shuffle_by_groups_fallback(self, tokens: List[str], groups_to_shuffle: List[str], 
                                   keep_first_n: int = 0, exclude_person_count: bool = False,
                                   shuffle_together: bool = False, rng=None) -> List[str]:
        """従来の実装（フォールバック用）"""
        import random
        if rng is None:
            rng = random.Random()
        
        if not groups_to_shuffle or not tokens:
            return tokens
        
        # 事前計算
        groups_set = set(groups_to_shuffle)
        start_idx = max(0, keep_first_n)
        
        # シャッフル対象を収集
        if shuffle_together:
            shuffleable = []
            for idx in range(start_idx, len(tokens)):
                token = self._strip_cached(tokens[idx])
                if not token:
                    continue
                group = self.get_tag_group(token)
                if group in groups_set:
                    if not (exclude_person_count and group == 'General' and self.is_person_count_tag(token)):
                        shuffleable.append((idx, token))
            
            if len(shuffleable) <= 1:
                return tokens
            
            # シャッフル実行
            result = tokens[:]
            indices = [x[0] for x in shuffleable]
            values = [x[1] for x in shuffleable]
            rng.shuffle(values)
            for idx, val in zip(indices, values):
                result[idx] = val
            return result
        else:
            # グループごとの処理
            classified = {}
            for idx in range(start_idx, len(tokens)):
                token = self._strip_cached(tokens[idx])
                if not token:
                    continue
                group = self.get_tag_group(token)
                if group in groups_set:
                    if not (exclude_person_count and group == 'General' and self.is_person_count_tag(token)):
                        if group not in classified:
                            classified[group] = []
                        classified[group].append((idx, token))
            
            # シャッフル不要なら早期リターン
            if all(len(classified.get(g, [])) <= 1 for g in groups_set):
                return tokens
            
            # シャッフル実行
            result = tokens[:]
            for group, items in classified.items():
                if len(items) > 1:
                    indices = [x[0] for x in items]
                    values = [x[1] for x in items]
                    rng.shuffle(values)
                    for idx, val in zip(indices, values):
                        result[idx] = val
            
            return result
    
    def clear_cache(self):
        """キャッシュをクリアする"""
        self._person_count_cache.clear()
        self._stripped_cache.clear()
        self.get_tag_group.cache_clear()
        self._strip_cached.cache_clear()