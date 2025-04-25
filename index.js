// index.js (使用 extension_settings 存储并包含自动迁移，优化了初始化, 添加全局/聊天模式)
import { extension_settings, loadExtensionSettings, getContext } from "../../../extensions.js";
// 尝试导入全局列表，路径可能需要调整！如果导入失败，迁移逻辑需要改用 API 调用
import { saveSettingsDebounced, eventSource, event_types, getRequestHeaders, characters } from "../../../../script.js";

import { groups } from "../../../group-chats.js";

const extensionName = "hide_2";
const defaultSettings = {
    // 全局默认设置
    enabled: true,
    // 新增：存储当前模式 ('global' or 'chat')
    mode: 'chat', // 默认使用聊天特定设置以兼容旧版
    // 新增：存储全局隐藏设置
    globalHideSettings: {
        hideLastN: 0,
        userConfigured: false, // 全局设置是否被用户配置过
    },
    // 用于存储每个实体设置的对象 (包含 hideLastN, userConfigured, lastProcessedLength)
    settings_by_entity: {},
    // 迁移标志
    migration_v1_complete: false,
};

// 缓存上下文
let cachedContext = null;

// DOM元素缓存
const domCache = {
    hideLastNInput: null,
    saveBtn: null,
    unhideBtn: null, // 添加取消隐藏按钮缓存
    currentValueDisplay: null,
    modeSelectPopup: null, // 添加弹出窗口模式选择器缓存
    popupCloseBtn: null, // 添加弹出窗口关闭按钮缓存
    wandButton: null, // 添加输入区按钮缓存
    // 初始化缓存
    init() {
        console.debug(`[${extensionName} DEBUG] Initializing DOM cache.`);
        this.hideLastNInput = document.getElementById('hide-last-n');
        this.saveBtn = document.getElementById('hide-save-settings-btn');
        this.unhideBtn = document.getElementById('hide-unhide-all-btn');
        this.currentValueDisplay = document.getElementById('hide-current-value');
        this.modeSelectPopup = document.getElementById('hide-helper-mode-popup');
        this.popupCloseBtn = document.getElementById('hide-helper-popup-close');
        this.wandButton = document.getElementById('hide-helper-wand-button');
        console.debug(`[${extensionName} DEBUG] DOM cache initialized:`, {
            hideLastNInput: !!this.hideLastNInput,
            saveBtn: !!this.saveBtn,
            unhideBtn: !!this.unhideBtn,
            currentValueDisplay: !!this.currentValueDisplay,
            modeSelectPopup: !!this.modeSelectPopup,
            popupCloseBtn: !!this.popupCloseBtn,
            wandButton: !!this.wandButton,
        });
    }
};

// 获取优化的上下文
function getContextOptimized() {
    // console.debug(`[${extensionName} DEBUG] Entering getContextOptimized.`); // 减少日志噪音
    if (!cachedContext) {
        // console.debug(`[${extensionName} DEBUG] Context cache miss. Calling getContext().`);
        cachedContext = getContext();
        // console.debug(`[${extensionName} DEBUG] Context fetched:`, cachedContext ? `CharacterId: ${cachedContext.characterId}, GroupId: ${cachedContext.groupId}, Chat Length: ${cachedContext.chat?.length}` : 'null');
    } else {
        // console.debug(`[${extensionName} DEBUG] Context cache hit.`);
    }
    return cachedContext;
}

// 辅助函数：获取当前上下文的唯一实体ID
function getCurrentEntityId() {
    const context = getContextOptimized();
    if (!context) return null;

    if (context.groupId) {
        return `group-${context.groupId}`;
    } else if (context.characterId !== undefined && context.characters && context.characters[context.characterId]) {
        const character = context.characters[context.characterId];
        if (character.avatar) {
            return `character-${character.avatar}`;
        } else {
            console.warn(`[${extensionName}] Cannot determine entityId for character at index ${context.characterId}: Missing avatar filename.`);
            return null;
        }
    }
    // console.debug(`[${extensionName} DEBUG] Could not determine entityId from context.`); // 减少日志噪音
    return null; // 无法确定实体
}

// 运行数据迁移 (从旧位置到新的全局位置 - 仅迁移到 settings_by_entity)
function runMigration() {
    console.log(`[${extensionName}] === 开始设置迁移过程 ===`);
    let migratedCount = 0;
    // 确保容器存在
    extension_settings[extensionName].settings_by_entity = extension_settings[extensionName].settings_by_entity || {};
    const settingsContainer = extension_settings[extensionName].settings_by_entity;
    console.log(`[${extensionName}] 目标设置容器已初始化/找到。`);

    // --- 迁移角色数据 ---
    console.log(`[${extensionName}] --- 开始角色设置迁移 ---`);
    if (typeof characters !== 'undefined' && Array.isArray(characters)) {
        console.log(`[${extensionName}] 全局 'characters' 数组已找到。角色数量: ${characters.length}。`);
        characters.forEach((character, index) => {
            // console.log(`[${extensionName}] 处理角色 #${index}: ${character ? character.name : '不可用'}`); // 减少日志噪音
            if (!character || !character.data || !character.data.extensions) {
                // console.log(`[${extensionName}]   跳过角色 #${index}: 缺少角色对象、data 或 extensions 属性。`);
                return;
            }
            try {
                const oldSettingsPath = 'character.data.extensions.hideHelperSettings';
                // console.log(`[${extensionName}]   尝试访问旧设置路径: ${oldSettingsPath}`); // 减少日志噪音
                const oldSettings = character.data.extensions.hideHelperSettings;
                if (oldSettings && typeof oldSettings === 'object' && oldSettings !== null) {
                     console.log(`[${extensionName}]   成功: 在 ${oldSettingsPath} 找到角色 ${character.name} 的旧设置对象。`); // 保留成功找到的日志
                    const hasHideLastN = typeof oldSettings.hideLastN === 'number';
                    const hasLastProcessedLength = typeof oldSettings.lastProcessedLength === 'number';
                    const isUserConfigured = oldSettings.userConfigured === true;
                    const isValidOldData = hasHideLastN || hasLastProcessedLength || isUserConfigured;
                    // console.log(`[${extensionName}]   验证旧设置数据: isValidOldData=${isValidOldData}`); // 减少日志噪音
                    if (isValidOldData) {
                        const avatarFileName = character.avatar;
                        // console.log(`[${extensionName}]   角色头像文件名: ${avatarFileName || '缺失'}`);
                        if (avatarFileName) {
                            const entityId = `character-${avatarFileName}`;
                            // console.log(`[${extensionName}]   生成的 entityId: ${entityId}`);
                            if (!settingsContainer.hasOwnProperty(entityId)) {
                                console.log(`[${extensionName}]   操作: 正在迁移 entityId '${entityId}' 的设置到新位置。`);
                                settingsContainer[entityId] = {
                                    hideLastN: oldSettings.hideLastN ?? 0,
                                    lastProcessedLength: oldSettings.lastProcessedLength ?? 0,
                                    userConfigured: oldSettings.userConfigured ?? false
                                };
                                migratedCount++;
                                console.log(`[${extensionName}]   entityId '${entityId}' 迁移成功。计数器增加到 ${migratedCount}。`);
                            } else {
                                // console.log(`[${extensionName}]   跳过迁移: 新位置已存在 entityId '${entityId}' 的数据。`);
                            }
                        } else {
                             console.warn(`[${extensionName}]   跳过迁移: 无法迁移角色 ${character.name || '不可用'} 的设置: 缺少头像文件名。`);
                        }
                    } else {
                         // console.warn(`[${extensionName}]   跳过迁移: 跳过角色 ${character.name || '不可用'} 的迁移: 旧设置数据无效或为空。`);
                    }
                } else {
                     // console.log(`[${extensionName}]   信息: 在 ${oldSettingsPath} 未找到旧设置对象。`);
                }
            } catch (charError) {
                 console.error(`[${extensionName}]   错误: 迁移索引 ${index} (名称: ${character.name || '不可用'}) 的角色设置时出错:`, charError);
            }
             // console.log(`[${extensionName}] 完成处理角色 #${index}。`);
        });
         console.log(`[${extensionName}] --- 完成角色设置迁移 ---`);
    } else {
         console.warn(`[${extensionName}] 无法迁移角色设置: 全局 'characters' 数组不可用或不是数组。`);
    }

    // --- 迁移群组数据 ---
    console.log(`[${extensionName}] --- 开始群组设置迁移 ---`);
    if (typeof groups !== 'undefined' && Array.isArray(groups)) {
        console.log(`[${extensionName}] 全局 'groups' 数组已找到。群组数量: ${groups.length}。`);
        groups.forEach((group, index) => {
            // console.log(`[${extensionName}] 处理群组 #${index}: ${group ? group.name : '不可用'} (ID: ${group ? group.id : '不可用'})`); // 减少日志噪音
             if (!group || !group.data) {
                // console.log(`[${extensionName}]   跳过群组 #${index}: 缺少群组对象或 data 属性。`);
                return;
            }
            try {
                const oldSettingsPath = 'group.data.hideHelperSettings';
                // console.log(`[${extensionName}]   尝试访问旧设置路径: ${oldSettingsPath}`); // 减少日志噪音
                const oldSettings = group.data.hideHelperSettings;
                if (oldSettings && typeof oldSettings === 'object' && oldSettings !== null) {
                     console.log(`[${extensionName}]   成功: 在 ${oldSettingsPath} 找到群组 ${group.name} 的旧设置对象。`); // 保留成功找到的日志
                    const hasHideLastN = typeof oldSettings.hideLastN === 'number';
                    const hasLastProcessedLength = typeof oldSettings.lastProcessedLength === 'number';
                    const isUserConfigured = oldSettings.userConfigured === true;
                    const isValidOldData = hasHideLastN || hasLastProcessedLength || isUserConfigured;
                    // console.log(`[${extensionName}]   验证旧设置数据: isValidOldData=${isValidOldData}`); // 减少日志噪音
                    if (isValidOldData) {
                        const groupId = group.id;
                         // console.log(`[${extensionName}]   群组 ID: ${groupId || '缺失'}`);
                        if (groupId) {
                            const entityId = `group-${groupId}`;
                             // console.log(`[${extensionName}]   生成的 entityId: ${entityId}`);
                            if (!settingsContainer.hasOwnProperty(entityId)) {
                                console.log(`[${extensionName}]   操作: 正在迁移 entityId '${entityId}' 的设置到新位置。`);
                                settingsContainer[entityId] = {
                                    hideLastN: oldSettings.hideLastN ?? 0,
                                    lastProcessedLength: oldSettings.lastProcessedLength ?? 0,
                                    userConfigured: oldSettings.userConfigured ?? false
                                };
                                migratedCount++;
                                console.log(`[${extensionName}]   entityId '${entityId}' 迁移成功。计数器增加到 ${migratedCount}。`);
                            } else {
                                // console.log(`[${extensionName}]   跳过迁移: 新位置已存在 entityId '${entityId}' 的数据。`);
                            }
                        } else {
                            console.warn(`[${extensionName}]   跳过迁移: 无法迁移索引 ${index} (名称: ${group.name || '不可用'}) 的群组设置: 缺少群组 ID。`);
                        }
                    } else {
                        // console.warn(`[${extensionName}]   跳过迁移: 跳过群组 ${group.name || '不可用'} 的迁移: 旧设置数据无效或为空。`);
                    }
                } else {
                     // console.log(`[${extensionName}]   信息: 在 ${oldSettingsPath} 未找到旧设置对象。`);
                }
            } catch (groupError) {
                console.error(`[${extensionName}]   错误: 迁移索引 ${index} (名称: ${group.name || '不可用'}) 的群组设置时出错:`, groupError);
            }
             // console.log(`[${extensionName}] 完成处理群组 #${index}。`);
        });
         console.log(`[${extensionName}] --- 完成群组设置迁移 ---`);
    } else {
        console.warn(`[${extensionName}] 无法迁移群组设置: 全局 'groups' 数组不可用或不是数组。`);
    }

    // --- 完成迁移 ---
     console.log(`[${extensionName}] === 结束迁移过程 ===`);
    if (migratedCount > 0) {
         console.log(`[${extensionName}] 迁移完成。成功将 ${migratedCount} 个实体的设置迁移到新的全局位置。`);
    } else {
         console.log(`[${extensionName}] 迁移完成。无需迁移设置，或未找到可迁移的旧数据。`);
    }

    // 无论是否迁移了数据，都将标志设置为 true，表示迁移过程已执行
    extension_settings[extensionName].migration_v1_complete = true;
    console.log(`[${extensionName}] 将 migration_v1_complete 标志设置为 true。`);
    saveSettingsDebounced();
    console.log(`[${extensionName}] 已调用 saveSettingsDebounced() 来持久化迁移标志和任何已迁移的数据。`);
    console.log(`[${extensionName}] === 迁移过程完毕 ===`);
}


// 初始化扩展设置 (包含迁移检查和新字段)
function loadSettings() {
    console.log(`[${extensionName}] Entering loadSettings.`);
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    // 使用 Object.assign 合并默认值，确保所有顶级键都存在
    // 注意：要先处理 migration_v1_complete，再合并其他，避免覆盖
    const migrationComplete = extension_settings[extensionName].migration_v1_complete || defaultSettings.migration_v1_complete;

    Object.assign(extension_settings[extensionName], {
        enabled: extension_settings[extensionName].hasOwnProperty('enabled') ? extension_settings[extensionName].enabled : defaultSettings.enabled,
        mode: extension_settings[extensionName].mode || defaultSettings.mode,
        globalHideSettings: { ...defaultSettings.globalHideSettings, ...(extension_settings[extensionName].globalHideSettings || {}) },
        settings_by_entity: extension_settings[extensionName].settings_by_entity || { ...defaultSettings.settings_by_entity },
        migration_v1_complete: migrationComplete, // 确保迁移标志不被覆盖
    });

    // --- 检查并运行迁移 ---
    if (!extension_settings[extensionName].migration_v1_complete) {
        console.log(`[${extensionName}] 迁移标志未找到或为 false。尝试进行迁移...`);
        try {
            runMigration(); // runMigration 现在只处理 settings_by_entity
        } catch (error) {
            console.error(`[${extensionName}] 执行迁移时发生错误:`, error);
        }
    } else {
        console.log(`[${extensionName}] 迁移标志为 true。跳过迁移。`);
    }
    // --------------------------

    console.log(`[${extensionName}] 设置已加载/初始化:`, JSON.parse(JSON.stringify(extension_settings[extensionName]))); // 深拷贝打印避免循环引用
}

// 创建UI面板 (仅包含全局开关)
function createUI() {
    console.log(`[${extensionName}] Entering createUI.`);
    const settingsHtml = `
    <div id="hide-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>隐藏助手</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="hide-helper-section">
                    <!-- 开启/关闭选项 -->
                    <div class="hide-helper-toggle-row">
                        <span class="hide-helper-label">插件状态:</span>
                        <select id="hide-helper-toggle">
                            <option value="enabled">开启</option>
                            <option value="disabled">关闭</option>
                        </select>
                    </div>
                    <!-- 模式切换已移至弹出窗口 -->
                </div>
                <hr class="sysHR">
            </div>
        </div>
    </div>`;

    console.log(`[${extensionName}] Appending settings UI to #extensions_settings.`);
    $("#extensions_settings").append(settingsHtml);
    // 注意：这里不再创建模式切换下拉框
    createInputWandButton();
    createPopup(); // 创建包含模式切换的弹出窗口
    setupEventListeners(); // 设置事件监听器
    console.log(`[${extensionName}] Scheduling DOM cache initialization.`);
    setTimeout(() => domCache.init(), 100); // DOM缓存稍后初始化
    console.log(`[${extensionName}] Exiting createUI.`);
}

// 创建输入区旁的按钮
function createInputWandButton() {
    console.log(`[${extensionName}] Entering createInputWandButton.`);
    const buttonHtml = `
    <div id="hide-helper-wand-button" class="list-group-item flex-container flexGap5" title="隐藏助手">
        <span style="padding-top: 2px;"><i class="fa-solid fa-ghost"></i></span>
        <span>隐藏助手</span>
    </div>`;
    console.log(`[${extensionName}] Appending wand button to #data_bank_wand_container.`);
    $('#data_bank_wand_container').append(buttonHtml);
    console.log(`[${extensionName}] Exiting createInputWandButton.`);
}

// 创建弹出对话框 (包含模式切换)
function createPopup() {
    console.log(`[${extensionName}] Entering createPopup.`);
    const popupHtml = `
    <div id="hide-helper-popup" class="hide-helper-popup">
        <div class="hide-helper-popup-title">隐藏助手设置</div>
        <div class="hide-helper-input-row">
            <button id="hide-save-settings-btn" class="hide-helper-btn">保存设置</button>
            <input type="number" id="hide-last-n" min="0" placeholder="隐藏最近N楼之前的消息">
            <button id="hide-unhide-all-btn" class="hide-helper-btn">取消隐藏</button>
        </div>
        <div class="hide-helper-current">
            <strong>当前生效设置 (<span id="hide-current-mode-display">聊天</span>):</strong> 隐藏 <span id="hide-current-value">无</span> 条之前的消息
        </div>
        <div class="hide-helper-popup-footer">
             <!-- 模式切换下拉框 -->
            <div class="hide-helper-mode-selector-container">
                 <label for="hide-helper-mode-popup" class="hide-helper-mode-label">模式:</label>
                 <select id="hide-helper-mode-popup" class="hide-helper-mode-select">
                     <option value="chat">聊天</option>
                     <option value="global">全局</option>
                 </select>
            </div>
            <!-- 关闭按钮 -->
            <button id="hide-helper-popup-close" class="hide-helper-close-btn">关闭</button>
        </div>
    </div>`;
    console.log(`[${extensionName}] Appending popup HTML to body.`);
    $('body').append(popupHtml);
    console.log(`[${extensionName}] Exiting createPopup.`);
}

// 获取当前生效的隐藏设置 (根据 mode 决定)
// 返回 { hideLastN: number, userConfigured: boolean } 或 null
function getCurrentEffectiveHideSettings() {
    console.debug(`[${extensionName} DEBUG] Entering getCurrentEffectiveHideSettings.`);
    const settingsRoot = extension_settings[extensionName];
    if (!settingsRoot) {
        console.warn(`[${extensionName} DEBUG] getCurrentEffectiveHideSettings: Root settings missing.`);
        return null;
    }

    const mode = settingsRoot.mode || 'chat';
    console.debug(`[${extensionName} DEBUG] getCurrentEffectiveHideSettings: Current mode is "${mode}".`);

    if (mode === 'global') {
        const globalSettings = settingsRoot.globalHideSettings || { hideLastN: 0, userConfigured: false };
        console.debug(`[${extensionName} DEBUG] getCurrentEffectiveHideSettings: Returning global settings:`, globalSettings);
        return { ...globalSettings }; // 返回副本
    } else { // mode === 'chat'
        const entityId = getCurrentEntityId();
        if (!entityId) {
            console.warn(`[${extensionName} DEBUG] getCurrentEffectiveHideSettings: Could not determine entityId for chat mode.`);
            return null; // 无法确定实体，无法获取聊天特定设置
        }
        const entitySettings = settingsRoot.settings_by_entity?.[entityId];
        const effectiveSettings = {
            hideLastN: entitySettings?.hideLastN ?? 0,
            userConfigured: entitySettings?.userConfigured ?? false,
            // lastProcessedLength is NOT returned here, it's internal state
        };
        console.debug(`[${extensionName} DEBUG] getCurrentEffectiveHideSettings: Returning chat-specific settings for entityId "${entityId}":`, effectiveSettings);
        return effectiveSettings;
    }
}

// 获取特定实体的完整设置（包括 lastProcessedLength）
function getEntitySettings(entityId) {
    if (!entityId) return null;
    const settingsRoot = extension_settings[extensionName];
    return settingsRoot?.settings_by_entity?.[entityId] || null;
}

// 保存隐藏设置 (根据 mode 保存 hideLastN, 但 lastProcessedLength 总是保存到实体)
function saveCurrentHideSettings(hideLastN) {
    console.log(`[${extensionName}] Entering saveCurrentHideSettings with hideLastN: ${hideLastN}`);
    const context = getContextOptimized();
    if (!context) {
        console.error(`[${extensionName}] Cannot save settings: Context not available.`);
        return false;
    }
    const settingsRoot = extension_settings[extensionName];
    if (!settingsRoot) {
        console.error(`[${extensionName}] Cannot save settings: Root settings object missing.`);
        return false;
    }

    const entityId = getCurrentEntityId(); // 获取当前实体ID，用于保存 lastProcessedLength
    if (!entityId && settingsRoot.mode === 'chat') {
        console.error(`[${extensionName}] Cannot save settings: Could not determine entityId for chat mode.`);
        toastr.error('无法保存设置：无法确定当前角色或群组。');
        return false;
    }

    const chatLength = context.chat?.length || 0;
    const valueToSave = hideLastN >= 0 ? hideLastN : 0;
    const mode = settingsRoot.mode || 'chat';
    console.log(`[${extensionName}] saveCurrentHideSettings: Saving for mode "${mode}", entityId "${entityId}", hideLastN=${valueToSave}, currentChatLength=${chatLength}`);

    // 确保 settings_by_entity 和对应的实体条目存在，以便存储 lastProcessedLength
    settingsRoot.settings_by_entity = settingsRoot.settings_by_entity || {};
    if (entityId) {
         settingsRoot.settings_by_entity[entityId] = settingsRoot.settings_by_entity[entityId] || {};
         settingsRoot.settings_by_entity[entityId].lastProcessedLength = chatLength; // *总是* 更新实体的处理长度
         console.log(`[${extensionName}] saveCurrentHideSettings: Updated lastProcessedLength=${chatLength} for entityId "${entityId}".`);
    } else {
        console.warn(`[${extensionName}] saveCurrentHideSettings: Cannot update lastProcessedLength because entityId is missing.`);
    }


    // 根据模式保存 hideLastN 和 userConfigured
    if (mode === 'global') {
        settingsRoot.globalHideSettings = settingsRoot.globalHideSettings || {};
        settingsRoot.globalHideSettings.hideLastN = valueToSave;
        settingsRoot.globalHideSettings.userConfigured = true;
        console.log(`[${extensionName}] saveCurrentHideSettings: Updated global settings: hideLastN=${valueToSave}, userConfigured=true.`);
    } else { // mode === 'chat'
        if (entityId) {
            settingsRoot.settings_by_entity[entityId].hideLastN = valueToSave;
            settingsRoot.settings_by_entity[entityId].userConfigured = true;
            console.log(`[${extensionName}] saveCurrentHideSettings: Updated chat-specific settings for entityId "${entityId}": hideLastN=${valueToSave}, userConfigured=true.`);
        }
        // 如果 entityId 缺失但在 chat 模式，则无法保存 hideLastN，已在前面报错
    }

    saveSettingsDebounced();
    console.log(`[${extensionName}] saveSettingsDebounced() called to persist changes.`);
    return true;
}


// 更新弹出窗口中的设置显示和模式选择器
function updateCurrentHideSettingsDisplay() {
    console.debug(`[${extensionName} DEBUG] Entering updateCurrentHideSettingsDisplay.`);
    const effectiveSettings = getCurrentEffectiveHideSettings();
    const settingsRoot = extension_settings[extensionName];
    const currentMode = settingsRoot?.mode || 'chat';

    console.debug(`[${extensionName} DEBUG] updateCurrentHideSettingsDisplay: Current mode is "${currentMode}", Effective settings:`, effectiveSettings);

    // 初始化 DOM 缓存（如果需要）
    if (!domCache.currentValueDisplay || !domCache.modeSelectPopup || !domCache.hideLastNInput) {
        console.debug(`[${extensionName} DEBUG] updateCurrentHideSettingsDisplay: DOM cache not fully ready, initializing.`);
        domCache.init();
        if (!domCache.currentValueDisplay || !domCache.modeSelectPopup || !domCache.hideLastNInput) {
            console.warn(`[${extensionName} DEBUG] updateCurrentHideSettingsDisplay: Required DOM elements still not found after init. Aborting update.`);
            return;
        }
    }

    // 更新当前生效值显示
    const displayValue = (effectiveSettings && effectiveSettings.hideLastN > 0) ? effectiveSettings.hideLastN : '无';
    console.debug(`[${extensionName} DEBUG] updateCurrentHideSettingsDisplay: Setting current value display text to: "${displayValue}"`);
    domCache.currentValueDisplay.textContent = displayValue;

    // 更新模式显示文本
    const modeDisplayText = currentMode === 'global' ? '全局' : '聊天';
    const modeDisplayElement = document.getElementById('hide-current-mode-display');
    if (modeDisplayElement) {
         modeDisplayElement.textContent = modeDisplayText;
    }

    // 更新输入框的值
    const inputValue = effectiveSettings?.hideLastN > 0 ? effectiveSettings.hideLastN : '';
    console.debug(`[${extensionName} DEBUG] updateCurrentHideSettingsDisplay: Setting input value to: "${inputValue}"`);
    domCache.hideLastNInput.value = inputValue;

    // 更新模式选择器的选中状态
    console.debug(`[${extensionName} DEBUG] updateCurrentHideSettingsDisplay: Setting mode select value to: "${currentMode}"`);
    domCache.modeSelectPopup.value = currentMode;

    console.debug(`[${extensionName} DEBUG] Exiting updateCurrentHideSettingsDisplay.`);
}

// 防抖函数
function debounce(fn, delay) {
    let timer;
    return function(...args) {
        // console.debug(`[${extensionName} DEBUG] Debounce: Clearing timer for ${fn.name}.`); // 减少日志噪音
        clearTimeout(timer);
        // console.debug(`[${extensionName} DEBUG] Debounce: Setting timer for ${fn.name} with delay ${delay}ms.`);
        timer = setTimeout(() => {
            console.debug(`[${extensionName} DEBUG] Debounce: Executing debounced function ${fn.name}.`);
            fn.apply(this, args);
        }, delay);
    };
}

// 防抖版本的全量检查
const runFullHideCheckDebounced = debounce(runFullHideCheck, 200);

// 检查是否应该执行隐藏/取消隐藏操作 (根据 mode 和 userConfigured)
function shouldProcessHiding() {
    console.debug(`[${extensionName} DEBUG] Entering shouldProcessHiding.`);
    const settingsRoot = extension_settings[extensionName];
    if (!settingsRoot?.enabled) {
        console.debug(`[${extensionName} DEBUG] shouldProcessHiding: Plugin is disabled globally. Returning false.`);
        return false;
    }

    const mode = settingsRoot.mode || 'chat';
    let isConfigured = false;

    if (mode === 'global') {
        isConfigured = settingsRoot.globalHideSettings?.userConfigured === true;
        console.debug(`[${extensionName} DEBUG] shouldProcessHiding: Mode is global. User configured: ${isConfigured}.`);
    } else { // mode === 'chat'
        const entityId = getCurrentEntityId();
        if (entityId) {
            isConfigured = settingsRoot.settings_by_entity?.[entityId]?.userConfigured === true;
            console.debug(`[${extensionName} DEBUG] shouldProcessHiding: Mode is chat. EntityId: "${entityId}". User configured: ${isConfigured}.`);
        } else {
            console.debug(`[${extensionName} DEBUG] shouldProcessHiding: Mode is chat, but entityId is missing. Assuming not configured.`);
            isConfigured = false;
        }
    }

    if (!isConfigured) {
        console.debug(`[${extensionName} DEBUG] shouldProcessHiding: No user-configured settings found for the current mode/entity. Returning false.`);
        return false;
    }

    console.debug(`[${extensionName} DEBUG] shouldProcessHiding: Plugin enabled and user configured settings found for current mode. Returning true.`);
    return true;
}

// 增量隐藏检查
async function runIncrementalHideCheck() {
    // console.debug(`[${extensionName} DEBUG] Entering runIncrementalHideCheck.`); // 减少日志噪音
    if (!shouldProcessHiding()) {
        // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: shouldProcessHiding returned false. Skipping.`);
        return;
    }

    const startTime = performance.now();
    const context = getContextOptimized();
    if (!context || !context.chat) {
        console.warn(`[${extensionName} DEBUG] runIncrementalHideCheck: Aborted. Context or chat data not available.`);
        return;
    }

    const chat = context.chat;
    const currentChatLength = chat.length;
    const entityId = getCurrentEntityId(); // Need entityId for lastProcessedLength

    // 获取当前生效的 hideLastN 值
    const effectiveSettings = getCurrentEffectiveHideSettings();
    const hideLastN = effectiveSettings?.hideLastN ?? 0;

    // 获取当前实体的处理长度 (总是从实体特定设置中读取)
    const entitySettings = getEntitySettings(entityId);
    const lastProcessedLength = entitySettings?.lastProcessedLength ?? 0;
    const isEntityUserConfigured = entitySettings?.userConfigured ?? false; // 用于判断是否需要保存长度变化

     console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: currentChatLength=${currentChatLength}, effectiveHideLastN=${hideLastN}, entityLastProcessedLength=${lastProcessedLength}`);

    // 如果当前长度 <= 上次处理长度，说明没有新消息，或者消息被删除了
    if (currentChatLength <= lastProcessedLength) {
        if (currentChatLength < lastProcessedLength) {
             console.warn(`[${extensionName} DEBUG] runIncrementalHideCheck: Skipped. Chat length decreased (${lastProcessedLength} -> ${currentChatLength}). Possibly a delete.`);
             // 如果长度减少，且此实体曾被用户配置过（即使当前是全局模式），也更新长度
             if (entityId && (isEntityUserConfigured || extension_settings[extensionName]?.globalHideSettings?.userConfigured)) {
                 console.log(`[${extensionName} DEBUG] runIncrementalHideCheck: Chat length decreased. Saving settings to update lastProcessedLength for entity ${entityId}.`);
                 saveCurrentHideSettings(hideLastN); // 保存会更新 entity 的 lastProcessedLength
             }
        } else {
             // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Skipped. Chat length did not increase.`);
        }
        return;
    }

    // 如果 hideLastN <= 0，不需要隐藏任何东西，但可能需要更新长度
    if (hideLastN <= 0) {
        console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: effectiveHideLastN <= 0. No hiding needed.`);
        if (entityId && lastProcessedLength !== currentChatLength && (isEntityUserConfigured || extension_settings[extensionName]?.globalHideSettings?.userConfigured)) {
             console.log(`[${extensionName} DEBUG] runIncrementalHideCheck: Length changed (${lastProcessedLength} -> ${currentChatLength}) with hideLastN <= 0. Saving settings to update lastProcessedLength for entity ${entityId}.`);
            saveCurrentHideSettings(hideLastN);
        }
        return;
    }

    // --- 主要增量逻辑 ---
    const targetVisibleStart = Math.max(0, currentChatLength - hideLastN);
    const previousVisibleStart = lastProcessedLength > 0 ? Math.max(0, lastProcessedLength - hideLastN) : 0;
     console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Calculated visible range: targetVisibleStart=${targetVisibleStart}, previousVisibleStart=${previousVisibleStart}`);

    let needsSave = false; // 标记是否需要保存设置（通常是因为长度变化）

    if (targetVisibleStart > previousVisibleStart) {
        const toHideIncrementally = [];
        const startIndex = previousVisibleStart;
        const endIndex = targetVisibleStart;
         console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Need to check messages in range [${startIndex}, ${endIndex}).`);

        for (let i = startIndex; i < endIndex; i++) {
            if (i >= chat.length) break; // 防止越界
            if (chat[i] && chat[i].is_system !== true) {
                toHideIncrementally.push(i);
                 // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Adding message ${i} to incremental hide list.`);
            }
        }

        if (toHideIncrementally.length > 0) {
            console.log(`[${extensionName}] Incrementally hiding ${toHideIncrementally.length} message(s): Indices [${toHideIncrementally.join(', ')}]`);
             console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Updating chat array data...`);
            toHideIncrementally.forEach(idx => { if (chat[idx]) chat[idx].is_system = true; });
            // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Chat array data updated.`);

            try {
                 console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Updating DOM elements...`);
                const hideSelector = toHideIncrementally.map(id => `.mes[mesid="${id}"]`).join(',');
                if (hideSelector) {
                    // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Applying selector: ${hideSelector}`);
                    $(hideSelector).attr('is_system', 'true');
                    // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: DOM update command issued.`);
                }
            } catch (error) {
                console.error(`[${extensionName}] Error updating DOM incrementally:`, error);
            }
            needsSave = true; // 隐藏了消息，需要保存新长度
        } else {
             console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: No messages needed hiding in the new range [${startIndex}, ${endIndex}).`);
             if (entityId && lastProcessedLength !== currentChatLength) {
                 needsSave = true; // 长度变了，即使没隐藏新消息也要保存
             }
        }
    } else {
         // console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Visible start did not advance or range invalid.`);
         if (entityId && lastProcessedLength !== currentChatLength) {
             needsSave = true; // 长度变了就要保存
         }
    }

    // 如果需要保存（通常因为长度变化），则调用保存函数
    if (needsSave && (isEntityUserConfigured || extension_settings[extensionName]?.globalHideSettings?.userConfigured)) {
         console.log(`[${extensionName}] runIncrementalHideCheck: Saving settings due to processing new messages or length change.`);
        saveCurrentHideSettings(hideLastN); // 保存会更新 entity 的 lastProcessedLength
    } else if (needsSave) {
        console.debug(`[${extensionName} DEBUG] runIncrementalHideCheck: Length changed, but no user configuration found for current mode/entity. Skipping save.`);
    }


    // console.debug(`[${extensionName} DEBUG] Incremental check completed in ${performance.now() - startTime}ms`); // 减少日志噪音
}

// 全量隐藏检查
async function runFullHideCheck() {
    console.log(`[${extensionName}] Entering runFullHideCheck.`);
    if (!shouldProcessHiding()) {
        console.log(`[${extensionName}] runFullHideCheck: shouldProcessHiding returned false. Skipping.`);
        return;
    }

    const startTime = performance.now();
    const context = getContextOptimized();
    if (!context || !context.chat) {
        console.warn(`[${extensionName}] runFullHideCheck: Aborted. Context or chat data not available.`);
        return;
    }
    const chat = context.chat;
    const currentChatLength = chat.length;
    const entityId = getCurrentEntityId(); // 需要实体ID来更新 lastProcessedLength
    console.log(`[${extensionName}] runFullHideCheck: Context OK. Chat length: ${currentChatLength}, EntityId: ${entityId}`);

    // 获取当前生效的 hideLastN 值
    const effectiveSettings = getCurrentEffectiveHideSettings();
    const hideLastN = effectiveSettings?.hideLastN ?? 0;
    const isEffectiveUserConfigured = effectiveSettings?.userConfigured ?? false; // 当前生效的设置是否被用户配置过

     console.log(`[${extensionName}] runFullHideCheck: Effective settings: hideLastN=${hideLastN}, isUserConfigured=${isEffectiveUserConfigured}`);

    const visibleStart = hideLastN <= 0 ? 0 : Math.max(0, currentChatLength - hideLastN);
    console.log(`[${extensionName}] runFullHideCheck: Calculated visibleStart index: ${visibleStart}`);

    const toHide = [];
    const toShow = [];
    let changed = false;
    console.log(`[${extensionName}] runFullHideCheck: Starting diff calculation...`);
    for (let i = 0; i < currentChatLength; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const isCurrentlyHidden = msg.is_system === true;
        const shouldBeHidden = i < visibleStart;

        if (shouldBeHidden && !isCurrentlyHidden) {
            msg.is_system = true;
            toHide.push(i);
            changed = true;
        } else if (!shouldBeHidden && isCurrentlyHidden) {
            msg.is_system = false;
            toShow.push(i);
            changed = true;
        }
    }
    console.log(`[${extensionName}] runFullHideCheck: Diff calculation done. Changes needed: ${changed}. To hide: ${toHide.length}, To show: ${toShow.length}.`);

    if (changed) {
        try {
            console.log(`[${extensionName}] runFullHideCheck: Applying DOM updates...`);
            if (toHide.length > 0) {
                const hideSelector = toHide.map(id => `.mes[mesid="${id}"]`).join(',');
                if (hideSelector) $(hideSelector).attr('is_system', 'true');
            }
            if (toShow.length > 0) {
                const showSelector = toShow.map(id => `.mes[mesid="${id}"]`).join(',');
                if (showSelector) $(showSelector).attr('is_system', 'false');
            }
             console.log(`[${extensionName}] runFullHideCheck: DOM updates applied.`);
        } catch (error) {
            console.error(`[${extensionName}] Error updating DOM in full check:`, error);
        }
    } else {
         console.log(`[${extensionName}] runFullHideCheck: No changes needed in chat data or DOM based on current settings.`);
    }

    // 检查是否需要保存 lastProcessedLength
    const entitySettings = getEntitySettings(entityId);
    const lastProcessedLength = entitySettings?.lastProcessedLength ?? 0;
    console.log(`[${extensionName}] runFullHideCheck: Checking if settings need saving. EntityLastProcessedLength=${lastProcessedLength}, currentChatLength=${currentChatLength}, isEffectiveUserConfigured=${isEffectiveUserConfigured}`);
    if (entityId && lastProcessedLength !== currentChatLength && isEffectiveUserConfigured) {
        console.log(`[${extensionName}] runFullHideCheck: Length changed (${lastProcessedLength} -> ${currentChatLength}) and effective settings are user configured. Saving settings to update lastProcessedLength.`);
        saveCurrentHideSettings(hideLastN); // 保存会更新 entity 的 lastProcessedLength
    } else {
         console.log(`[${extensionName}] runFullHideCheck: Settings save not required (length unchanged or effective settings not user configured).`);
    }
    console.log(`[${extensionName}] Full check completed in ${performance.now() - startTime}ms`);
}

// 全部取消隐藏功能 (重置当前生效的设置为 0)
async function unhideAllMessages() {
    const startTime = performance.now();
    console.log(`[${extensionName}] Entering unhideAllMessages.`);
    const context = getContextOptimized();
    const entityId = getCurrentEntityId();
    const settingsRoot = extension_settings[extensionName];
    const mode = settingsRoot?.mode || 'chat';

    // 即使 chat 数据不可用，也要尝试重置设置
    if (!context || !context.chat) {
         console.warn(`[${extensionName}] Unhide all: Chat data not available. Will only reset the hide setting.`);
         if (mode === 'chat' && !entityId) {
              console.error(`[${extensionName}] Unhide all aborted: Cannot determine entityId in chat mode to reset settings.`);
              toastr.error('无法取消隐藏：无法确定当前目标。');
              return;
         }
    }

    // 1. 更新 chat 数据和 DOM (如果 chat 可用)
    if (context && context.chat) {
        const chat = context.chat;
        const chatLength = chat.length;
        console.log(`[${extensionName}] Unhide all: Chat length is ${chatLength}.`);

        const toShow = [];
        console.log(`[${extensionName}] Unhide all: Scanning chat for hidden messages...`);
        for (let i = 0; i < chatLength; i++) {
            if (chat[i] && chat[i].is_system === true) {
                // console.debug(`[${extensionName} DEBUG] Unhide all: Found hidden message at index ${i}. Marking to show.`);
                toShow.push(i);
            }
        }
        console.log(`[${extensionName}] Unhide all: Found ${toShow.length} messages to unhide.`);

        if (toShow.length > 0) {
            console.log(`[${extensionName}] Unhide all: Updating chat array data...`);
            toShow.forEach(idx => { if (chat[idx]) chat[idx].is_system = false; });
            // console.log(`[${extensionName}] Unhide all: Chat data updated.`);
            try {
                console.log(`[${extensionName}] Unhide all: Updating DOM...`);
                const showSelector = toShow.map(id => `.mes[mesid="${id}"]`).join(',');
                if (showSelector) {
                     // console.debug(`[${extensionName} DEBUG] Unhide all: Applying selector: ${showSelector}`);
                     $(showSelector).attr('is_system', 'false');
                     console.log(`[${extensionName}] Unhide all: DOM updated.`);
                }
            } catch (error) {
                console.error(`[${extensionName}] Error updating DOM when unhiding all:`, error);
            }
        } else {
            console.log(`[${extensionName}] Unhide all: No hidden messages found to change in chat data.`);
        }
    }

    // 2. 保存设置 (将当前生效模式的 hideLastN 设为 0)
    console.log(`[${extensionName}] Unhide all: Saving hide setting as 0 for mode "${mode}".`);
    const success = saveCurrentHideSettings(0); // saveCurrentHideSettings 会处理模式
    if (success) {
        console.log(`[${extensionName}] Unhide all: Hide setting successfully reset to 0 for current mode.`);
        updateCurrentHideSettingsDisplay(); // 更新弹出窗口显示
        toastr.success('已取消隐藏，设置已重置为0');
    } else {
        console.error(`[${extensionName}] Unhide all: Failed to issue command to reset hide setting to 0.`);
        toastr.error('重置隐藏设置失败');
    }
     console.log(`[${extensionName}] Unhide all completed in ${performance.now() - startTime}ms`);
}

// 设置UI元素的事件监听器
function setupEventListeners() {
    console.log(`[${extensionName}] Entering setupEventListeners.`);

    // 确保 DOM 缓存已初始化
    if (!domCache.wandButton) {
         console.log(`[${extensionName}] setupEventListeners: DOM cache not ready, initializing first.`);
         domCache.init();
    }

    // 输入区按钮点击事件 -> 打开弹出窗口
    if (domCache.wandButton) {
        console.log(`[${extensionName}] Setting up click listener for wand button.`);
        $(domCache.wandButton).on('click', function() {
            console.log(`[${extensionName}] Wand button clicked.`);
            if (!extension_settings[extensionName]?.enabled) {
                console.warn(`[${extensionName}] Wand button clicked but extension is disabled.`);
                toastr.warning('隐藏助手当前已禁用，请在扩展设置中启用。');
                return;
            }
            console.log(`[${extensionName}] Wand button: Extension enabled. Updating display before showing popup.`);
            updateCurrentHideSettingsDisplay(); // 更新显示以反映当前状态和模式

            const $popup = $('#hide-helper-popup');
            console.log(`[${extensionName}] Wand button: Displaying popup.`);
            $popup.css({
                'display': 'block', 'visibility': 'hidden', 'position': 'fixed',
                'left': '50%', 'transform': 'translateX(-50%)'
            });
            setTimeout(() => {
                // console.debug(`[${extensionName} DEBUG] Wand button: Calculating popup position.`); // 减少日志噪音
                const popupHeight = $popup.outerHeight();
                const windowHeight = $(window).height();
                const topPosition = Math.max(10, Math.min((windowHeight - popupHeight) / 2, windowHeight - popupHeight - 50));
                 // console.debug(`[${extensionName} DEBUG] Wand button: Calculated topPosition: ${topPosition}px. Making popup visible.`);
                $popup.css({ 'top': topPosition + 'px', 'visibility': 'visible' });
            }, 0);
        });
    } else {
        console.error(`[${extensionName}] Could not find wand button (#hide-helper-wand-button) to attach listener.`);
    }

    // 弹出框关闭按钮事件
    if (domCache.popupCloseBtn) {
        console.log(`[${extensionName}] Setting up click listener for popup close button.`);
        $(domCache.popupCloseBtn).on('click', function() {
            console.log(`[${extensionName}] Popup close button clicked.`);
            $('#hide-helper-popup').hide();
        });
    } else {
         console.error(`[${extensionName}] Could not find popup close button (#hide-helper-popup-close) to attach listener.`);
    }

    // 弹出窗口模式切换事件
    if (domCache.modeSelectPopup) {
        console.log(`[${extensionName}] Setting up change listener for popup mode selector.`);
        $(domCache.modeSelectPopup).on('change', function() {
            const newMode = $(this).val(); // 'global' or 'chat'
             console.log(`[${extensionName}] Popup mode selector changed. New mode: "${newMode}"`);
            if (extension_settings[extensionName]) {
                extension_settings[extensionName].mode = newMode;
                 console.log(`[${extensionName}] Saving settings due to mode change.`);
                saveSettingsDebounced();

                // 立即更新弹出窗口的显示以反映新模式
                updateCurrentHideSettingsDisplay();

                // 应用新模式下的隐藏规则
                console.log(`[${extensionName}] Mode changed to "${newMode}". Running full check.`);
                runFullHideCheckDebounced(); // 切换模式需要全量检查
                toastr.info(`隐藏模式已切换为: ${newMode === 'global' ? '全局' : '聊天'}`);
            }
        });
    } else {
         console.error(`[${extensionName}] Could not find popup mode selector (#hide-helper-mode-popup) to attach listener.`);
    }


    // 全局启用/禁用切换事件 (在扩展设置面板)
    console.log(`[${extensionName}] Setting up change listener for #hide-helper-toggle.`);
    $('#hide-helper-toggle').on('change', function() {
        const isEnabled = $(this).val() === 'enabled';
        console.log(`[${extensionName}] Global toggle changed. New state: ${isEnabled ? 'enabled' : 'disabled'}`);
        if (extension_settings[extensionName]) {
            extension_settings[extensionName].enabled = isEnabled;
            console.log(`[${extensionName}] Saving global settings due to toggle change.`);
            saveSettingsDebounced();
        }

        if (isEnabled) {
            console.log(`[${extensionName}] Extension enabled via toggle. Running full check.`);
            toastr.success('隐藏助手已启用');
            runFullHideCheckDebounced();
        } else {
            console.log(`[${extensionName}] Extension disabled via toggle. Running full check to unhide everything if needed.");
            toastr.warning('隐藏助手已禁用');
            // 当禁用时，运行一次全量检查，如果之前有隐藏，会取消隐藏
             runFullHideCheckDebounced();
        }
    });

    // 输入框输入事件
    if (domCache.hideLastNInput) {
        console.log(`[${extensionName}] Setting up input listener for #hide-last-n.`);
        domCache.hideLastNInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
             // console.debug(`[${extensionName} DEBUG] Input field changed. Raw value: "${e.target.value}", Parsed value: ${value}`); // 减少日志
            if (isNaN(value) || value < 0) {
                 // console.debug(`[${extensionName} DEBUG] Input invalid or negative. Clearing input field.`);
                 e.target.value = '';
            } else {
                 // console.debug(`[${extensionName} DEBUG] Input valid. Keeping value: ${value}`);
                 e.target.value = value; // 保持合法数字
            }
        });
    } else {
        console.warn(`[${extensionName}] Could not find #hide-last-n input element to attach listener.`);
    }

    // 保存设置按钮事件 (弹出窗口)
    if (domCache.saveBtn && domCache.hideLastNInput) {
        console.log(`[${extensionName}] Setting up click listener for popup save settings button.`);
        $(domCache.saveBtn).on('click', function() {
            console.log(`[${extensionName}] Save settings button clicked.`);
            const value = parseInt(domCache.hideLastNInput.value);
            const valueToSave = isNaN(value) || value < 0 ? 0 : value;
            const currentMode = extension_settings[extensionName]?.mode || 'chat';
             console.log(`[${extensionName}] Save button: Parsed input value: ${value}. Value to save: ${valueToSave} for mode "${currentMode}".`);

            const effectiveSettings = getCurrentEffectiveHideSettings();
            const currentValue = effectiveSettings?.hideLastN ?? 0;
             console.log(`[${extensionName}] Save button: Current effective value: ${currentValue}`);

            if (valueToSave !== currentValue || !effectiveSettings?.userConfigured) { // 如果值不同 或 之前未配置，则保存
                console.log(`[${extensionName}] Save button: Value changed or not configured. Proceeding with save.`);
                const $btn = $(this);
                const originalText = $btn.text();
                $btn.text('保存中...').prop('disabled', true);

                console.log(`[${extensionName}] Save button: Calling saveCurrentHideSettings(${valueToSave}).`);
                const success = saveCurrentHideSettings(valueToSave); // 函数内部处理模式
                 console.log(`[${extensionName}] Save button: saveCurrentHideSettings returned: ${success}`);

                if (success) {
                    console.log(`[${extensionName}] Save button: Save instruction issued successfully. Running full check and updating display.`);
                    runFullHideCheck(); // 直接运行检查以立即应用
                    updateCurrentHideSettingsDisplay(); // 更新弹出窗口显示
                    toastr.success('隐藏设置已保存');
                } else {
                     console.error(`[${extensionName}] Save button: Save instruction failed.`);
                }

                // console.log(`[${extensionName}] Save button: Restoring button state.`); // 延迟恢复，给用户反馈时间
                setTimeout(() => $btn.text(originalText).prop('disabled', false), 500);

            } else {
                console.log(`[${extensionName}] Save button: Value (${valueToSave}) hasn't changed from current (${currentValue}). Skipping save.`);
                toastr.info('设置未更改');
            }
        });
    } else {
         console.error(`[${extensionName}] Could not find save button or input field to attach listener.`);
    }

    // 全部取消隐藏按钮事件 (弹出窗口)
    if (domCache.unhideBtn) {
        console.log(`[${extensionName}] Setting up click listener for popup unhide all button.`);
        $(domCache.unhideBtn).on('click', async function() {
            console.log(`[${extensionName}] Unhide all button clicked.`);
            await unhideAllMessages(); // 函数内部处理模式并更新显示
            console.log(`[${extensionName}] Unhide all process finished.`);
        });
    } else {
        console.error(`[${extensionName}] Could not find unhide button (#hide-unhide-all-btn) to attach listener.`);
    }


    // --- 核心事件监听 ---

    // 聊天切换事件
    console.log(`[${extensionName}] Setting up listener for event: ${event_types.CHAT_CHANGED}`);
    eventSource.on(event_types.CHAT_CHANGED, (data) => {
        console.log(`[${extensionName}] Event received: ${event_types.CHAT_CHANGED}`, data);
        console.log(`[${extensionName}] CHAT_CHANGED: Clearing context cache.`);
        cachedContext = null; // 清除缓存

        const newContext = getContextOptimized(); // 获取新上下文
        const newEntityId = getCurrentEntityId();
        console.log(`[${extensionName}] CHAT_CHANGED: New context entityId: ${newEntityId}`);

        // 更新全局开关的显示状态 (虽然它不在弹出框，但逻辑上保持一致)
        // console.log(`[${extensionName}] CHAT_CHANGED: Updating global toggle display.`);
        $('#hide-helper-toggle').val(extension_settings[extensionName]?.enabled ? 'enabled' : 'disabled');

        // 更新弹出窗口的显示（如果它恰好是打开的）
        // console.log(`[${extensionName}] CHAT_CHANGED: Updating current hide settings display for new chat/entity.`);
        updateCurrentHideSettingsDisplay();

        if (extension_settings[extensionName]?.enabled) {
            console.log(`[${extensionName}] CHAT_CHANGED: Extension is enabled. Scheduling debounced full hide check.`);
            runFullHideCheckDebounced(); // 切换聊天后进行全量检查
        } else {
            console.log(`[${extensionName}] CHAT_CHANGED: Extension is disabled. Skipping full hide check.`);
        }
    });

    // 新消息事件 (增量检查)
    const handleNewMessage = (eventType) => {
        // console.debug(`[${extensionName} DEBUG] Event received: ${eventType}`); // 减少日志
        if (extension_settings[extensionName]?.enabled) {
            // console.debug(`[${extensionName} DEBUG] ${eventType}: Extension enabled. Scheduling incremental hide check.`);
            // 使用更短的延迟，尽快隐藏新消息
            setTimeout(() => runIncrementalHideCheck(), 50);
        }
    };
    console.log(`[${extensionName}] Setting up listener for event: ${event_types.MESSAGE_RECEIVED}`);
    eventSource.on(event_types.MESSAGE_RECEIVED, () => handleNewMessage(event_types.MESSAGE_RECEIVED));
    console.log(`[${extensionName}] Setting up listener for event: ${event_types.MESSAGE_SENT}`);
    eventSource.on(event_types.MESSAGE_SENT, () => handleNewMessage(event_types.MESSAGE_SENT));

    // 消息删除/滑动事件 (需要全量检查)
    const handleChatStructureChange = (eventType) => {
         console.log(`[${extensionName}] Event received: ${eventType}`);
        if (extension_settings[extensionName]?.enabled) {
            console.log(`[${extensionName}] ${eventType}: Extension enabled. Scheduling debounced full hide check.`);
            runFullHideCheckDebounced();
        } else {
             console.log(`[${extensionName}] ${eventType}: Extension disabled. Skipping full check.`);
        }
    };
    console.log(`[${extensionName}] Setting up listener for event: ${event_types.MESSAGE_DELETED}`);
    eventSource.on(event_types.MESSAGE_DELETED, () => handleChatStructureChange(event_types.MESSAGE_DELETED));
    console.log(`[${extensionName}] Setting up listener for event: ${event_types.MESSAGE_SWIPED}`);
    eventSource.on(event_types.MESSAGE_SWIPED, () => handleChatStructureChange(event_types.MESSAGE_SWIPED)); // 滑动也可能改变可见消息数

    // 生成结束事件 (确保最终状态正确，用全量检查)
    const streamEndEvent = event_types.GENERATION_ENDED;
    console.log(`[${extensionName}] Setting up listener for event: ${streamEndEvent} (generation ended)`);
    eventSource.on(streamEndEvent, () => {
         console.log(`[${extensionName}] Event received: ${streamEndEvent}`);
         if (extension_settings[extensionName]?.enabled) {
            console.log(`[${extensionName}] ${streamEndEvent}: Extension enabled. Scheduling debounced full hide check after generation end.`);
            runFullHideCheckDebounced(); // 生成结束后全量检查一次
        } else {
             console.log(`[${extensionName}] ${streamEndEvent}: Extension disabled. Skipping full check.`);
        }
    });

    console.log(`[${extensionName}] Exiting setupEventListeners.`);
}

// 初始化扩展
jQuery(async () => {
    console.log(`[${extensionName}] Initializing extension (jQuery ready)...`);

    let isInitialized = false;
    const initializeExtension = () => {
        if (isInitialized) {
            console.log(`[${extensionName}] 初始化已运行。跳过。`);
            return;
        }
        isInitialized = true;
        console.log(`[${extensionName}] 由 app_ready 事件触发，运行初始化任务。`);

        try {
            // 1. 加载设置 (包含迁移检查和新字段初始化)
            loadSettings();

            // 2. 创建 UI (面板+弹出框)
            createUI();

            // 3. 更新初始 UI 状态
            console.log(`[${extensionName}] 初始设置: 设置全局开关显示。`);
            $('#hide-helper-toggle').val(extension_settings[extensionName]?.enabled ? 'enabled' : 'disabled');

            // 更新弹出窗口显示（模式选择器+当前值）
            console.log(`[${extensionName}] 初始设置: 更新弹出窗口显示。`);
            updateCurrentHideSettingsDisplay();

            // 4. 初始加载时执行全量检查 (如果插件启用且当前模式/实体有用户配置)
            if (extension_settings[extensionName]?.enabled) {
                console.log(`[${extensionName}] 初始设置: 插件已启用。检查是否需要初始全量检查。`);
                const initialEffectiveSettings = getCurrentEffectiveHideSettings();
                console.log(`[${extensionName}] 初始设置: 读取当前生效的初始设置:`, initialEffectiveSettings);
                if(initialEffectiveSettings?.userConfigured === true) {
                    console.log(`[${extensionName}] 初始设置: 找到当前生效的用户配置设置。运行初始全量隐藏检查。`);
                    runFullHideCheck(); // 直接运行，非防抖
                } else {
                    console.log(`[${extensionName}] 初始设置: 未找到当前生效的用户配置设置。跳过初始全量检查.`);
                }
            } else {
                 console.log(`[${extensionName}] 初始设置: 插件已禁用。跳过初始全量检查。`);
            }
            console.log(`[${extensionName}] 初始设置任务完成。`);
        } catch (error) {
            console.error(`[${extensionName}] 初始化过程中发生严重错误:`, error);
            toastr.error("Hide Helper 插件初始化失败，请检查控制台日志。");
        }
    };

    // 优先使用 app_ready 事件
    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
        console.log(`[${extensionName}] 等待 '${event_types.APP_READY}' 事件进行初始化...`);
        eventSource.on(event_types.APP_READY, initializeExtension);
    } else {
        console.error(`[${extensionName}] 严重错误: 事件类型 'APP_READY' 在 event_types 中未找到，或 eventSource/event_types 未定义。无法保证正确初始化！回退到延迟。`);
        const initialDelay = 2500; // 稍长一点的延迟以防万一
        console.warn(`[${extensionName}] 使用延迟 ${initialDelay}ms 计划初始设置任务 (回退方案)`);
        setTimeout(initializeExtension, initialDelay);
    }
});
