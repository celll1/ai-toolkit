import json
import os
import re
from typing import Dict, List, Set, Tuple, Optional
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

class TagGroupManager:
    def __init__(self, tag_group_dir: str = 'taggroup'):
        self.tag_group_dir = tag_group_dir
        self.tag_groups: Dict[str, Set[str]] = {}
        self.tag_to_group: Dict[str, str] = {}
        self._loaded = False
        # Person count tagのキャッシュを追加
        self._person_count_cache: Dict[str, bool] = {}
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
        for json_file in json_files:
            group_name = json_file.stem
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Store tags as a set for faster lookup
                    tag_set = set(data.keys())
                    self.tag_groups[group_name] = tag_set
                    # Map each tag to its group (dictの更新を一括で行う)
                    self.tag_to_group.update({tag: group_name for tag in tag_set})
            except Exception as e:
                print(f"Warning: Failed to load tag group {json_file}: {e}")
        
        self._loaded = True
    
    @lru_cache(maxsize=1024)  # よく使われるタグをキャッシュ
    def get_tag_group(self, tag: str) -> str:
        """Get the group name for a given tag, returns 'General' if not found in any group"""
        # Strip whitespace for matching
        tag = tag.strip()
        return self.tag_to_group.get(tag, 'General')
    
    def is_person_count_tag(self, tag: str) -> bool:
        """Check if a tag is a person count related tag"""
        tag = tag.strip()
        
        # キャッシュをチェック
        if tag in self._person_count_cache:
            return self._person_count_cache[tag]
        
        # キャッシュにない場合は計算して保存
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
    
    def shuffle_by_groups(self, tokens: List[str], groups_to_shuffle: List[str], 
                         keep_first_n: int = 0, exclude_person_count: bool = False,
                         shuffle_together: bool = False, rng=None) -> List[str]:
        """
        Shuffle only tokens belonging to specified groups while keeping others in place.
        
        Args:
            tokens: List of tokens to process
            groups_to_shuffle: List of group names to shuffle
            keep_first_n: Number of first tokens to keep in place
            exclude_person_count: If True, exclude person count tags from shuffling
            shuffle_together: If True, shuffle all selected groups together
            rng: Random number generator to use for shuffling
        
        Returns:
            List of tokens with specified groups shuffled
        """
        import random
        if rng is None:
            rng = random.Random()
        
        # If no groups specified or tokens, return original
        if not groups_to_shuffle or not tokens:
            return tokens
        
        # 効率化: 必要な場合のみコピーを作成
        result = None  # 遅延初期化
        
        # グループのセットを作成（高速な存在チェックのため）
        groups_to_shuffle_set = set(groups_to_shuffle)
        
        # 分類用の変数
        classified = {} if not shuffle_together else None
        all_shuffleable = [] if shuffle_together else None
        
        # 開始インデックスを計算
        start_idx = max(0, keep_first_n)
        
        # トークンを一度だけループ
        for idx in range(start_idx, len(tokens)):
            token = tokens[idx].strip()
            if not token:
                continue
                
            group = self.get_tag_group(token)
            if group not in groups_to_shuffle_set:
                continue
                
            # Person count tagのチェック（必要な場合のみ）
            if exclude_person_count and group == 'General' and self.is_person_count_tag(token):
                continue
            
            # シャッフル対象として記録
            if shuffle_together:
                all_shuffleable.append((idx, token))
            else:
                if group not in classified:
                    classified[group] = []
                classified[group].append((idx, token))
        
        # シャッフルが必要ない場合は元のリストを返す
        if shuffle_together and len(all_shuffleable) <= 1:
            return tokens
        elif not shuffle_together and all(len(classified.get(g, [])) <= 1 for g in groups_to_shuffle_set):
            return tokens
        
        # ここで初めてコピーを作成
        result = tokens.copy()
        
        if shuffle_together:
            # すべてのグループを一緒にシャッフル
            if all_shuffleable:
                indices, values = zip(*all_shuffleable)
                shuffled_values = list(values)
                rng.shuffle(shuffled_values)
                for idx, val in zip(indices, shuffled_values):
                    result[idx] = val
        else:
            # 各グループごとにシャッフル
            for group in groups_to_shuffle_set:
                if group in classified and len(classified[group]) > 1:
                    group_items = classified[group]
                    indices, values = zip(*group_items)
                    shuffled_values = list(values)
                    rng.shuffle(shuffled_values)
                    for idx, val in zip(indices, shuffled_values):
                        result[idx] = val
        
        return result
    
    def clear_cache(self):
        """キャッシュをクリアする（メモリ使用量が気になる場合）"""
        self._person_count_cache.clear()
        self.get_tag_group.cache_clear()