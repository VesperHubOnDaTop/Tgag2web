-- ====================================================
-- SCRIPT สำหรับ Roblox Executor (พร้อมระบบ Key Verification)
-- ====================================================
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local localPlayer = Players.LocalPlayer
local httpRequest = syn and syn.request or http_request or request

local WEB_URL = "http://127.0.0.1:3000" -- แนะนำใช้ 127.0.0.1 เพื่อความเสถียร
local LICENSE_KEY = "GAG2-TEST-1111-2222" -- 🔑 ใส่ License Key ของผู้ใช้งานที่ได้จากหน้าเว็บ

-- ==========================================
-- 0. ระบบตรวจสอบ License Key & HWID
-- ==========================================
local function GetHWID()
    local success, result = pcall(function()
        return game:GetService("RbxAnalyticsService"):GetClientId()
    end)
    if success and result then
        return result
    end
    return tostring(localPlayer.UserId) .. "-DEVICE-HWID"
end

local function VerifyLicenseKey()
    print("⏳ กำลังตรวจสอบ License Key กับเซิร์ฟเวอร์...")
    
    local requestData = {
        key = LICENSE_KEY,
        hwid = GetHWID()
    }
    
    local success, res = pcall(function()
        return httpRequest({
            Url = WEB_URL .. "/api/verify-key",
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body = HttpService:JSONEncode(requestData)
        })
    end)

    if success and res and res.StatusCode == 200 then
        local data = HttpService:JSONDecode(res.Body)
        if data.success then
            print("========================================")
            print("✅ " .. data.message) -- จะขึ้น: "เชื่อมต่อกับระบบเว็บเรียบร้อย"
            print("========================================")
            return true
        else
            warn("========================================")
            warn("❌ " .. data.message) -- เช่น: "คุณต้องชำระเงินก่อนใช้ระบบนี้"
            warn("========================================")
            return false
        end
    else
        warn("❌ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อตรวจสอบ Key ได้!")
        return false
    end
end

-- 🛑 ทำการเช็ค คีย์ ก่อนเริ่มต้นทำอย่างอื่น
if not VerifyLicenseKey() then
    warn("⛔ การทำงานถูกระงับ: กรุณาชำระเงินหรือตรวจสอบ License Key ของคุณ")
    return -- หยุดการทำงานสคริปต์ทันที
end

-- ==========================================
-- ระบบหลัก (จะทำงานเฉพาะเมื่อผ่านการเช็คคีย์แล้ว)
-- ==========================================

local Networking
local success, err = pcall(function()
    Networking = require(ReplicatedStorage:WaitForChild("SharedModules"):WaitForChild("Networking"))
end)

if not success then
    warn("❌ ไม่พบ Networking Module: " .. tostring(err))
    return
end

local Mailbox = Networking.Mailbox
local MAX_ITEM_PER_SEND = 9999

-- ฟังก์ชันดึงรายการไอเทมในกระเป๋าปัจจุบัน
function GetMyInventory()
    local items = {}
    local success, PlayerStateClient = pcall(function()
        return require(ReplicatedStorage:WaitForChild("ClientModules"):WaitForChild("PlayerStateClient"))
    end)
    
    if success and PlayerStateClient then
        local LocalReplica = PlayerStateClient:GetLocalReplica()
        if LocalReplica and LocalReplica.Data and LocalReplica.Data.Inventory then
            local Inventory = LocalReplica.Data.Inventory
            local categories = {
                Trowels = "Trowels", Seeds = "Seeds", Sprinklers = "Sprinklers",
                WateringCans = "WateringCans", Mushrooms = "Mushrooms", Gnomes = "Gnomes",
                Raccoons = "Raccoons", Crates = "Crates", SeedPacks = "SeedPacks", Props = "Props"
            }
            for category, catName in pairs(categories) do
                if Inventory[category] then
                    for name, count in pairs(Inventory[category]) do
                        if count > 0 then
                            table.insert(items, { Category = catName, ItemKey = name, Count = count, DisplayName = name })
                        end
                    end
                end
            end
            if Inventory.Pets then
                for id, data in pairs(Inventory.Pets) do
                    if data and not data.Equipped then
                        table.insert(items, { Category = "Pets", ItemKey = id, Count = 1, DisplayName = data.Name or id })
                    end
                end
            end
        end
    end
    return items
end

-- ดึงจำนวนไอเทมเฉพาะชิ้น
function GetItemCount(inventory, category, itemKey)
    for _, item in ipairs(inventory) do
        if item.Category == category and item.ItemKey == itemKey then
            return item.Count or 0
        end
    end
    return 0
end

-- ยิงคำสั่งส่งจดหมาย/ของ
function SendSingleMail(targetUserId, category, itemKey, count, note)
    local items = {{Category = category, ItemKey = itemKey, Count = count or 1}}
    local batchData = {}
    for _, item in ipairs(items) do
        local c = item.Count
        while c > 0 do
            local sendAmount = math.min(c, MAX_ITEM_PER_SEND)
            table.insert(batchData, { Category = item.Category, ItemKey = item.ItemKey, Count = sendAmount })
            c = c - sendAmount
        end
    end
    
    local ok = pcall(function()
        Mailbox.SendBatch:Fire(targetUserId, batchData, note or "")
    end)
    return ok
end

function SearchPlayerGlobal(username)
    if not username or username == "" then return nil end
    local ok, userId = pcall(function()
        return Players:GetUserIdFromNameAsync(username)
    end)
    if ok and userId then
        return { UserId = userId, Name = username }
    end
    return nil
end

-- ฟังก์ชันประมวลผลคิว พร้อมเช็คผล Success / Fail จากกระเป๋าจริง
function ProcessMultiItemQueue(targetUsername, itemsList, note, webhookUrl)
    local playerData = SearchPlayerGlobal(targetUsername)
    if not playerData then
        warn("❌ ไม่พบผู้รับ: " .. targetUsername)
        return
    end

    local itemResults = {}
    local totalSuccess = 0
    local totalFail = 0

    for _, targetItem in ipairs(itemsList) do
        local cat = targetItem.category
        local key = targetItem.itemKey
        local reqAmount = targetItem.amount

        -- 1. เช็คกระเป๋าก่อนส่ง
        local currentInvBefore = GetMyInventory()
        local haveAmountBefore = GetItemCount(currentInvBefore, cat, key)

        if haveAmountBefore > 0 then
            local finalAmount = (reqAmount <= 0 or reqAmount > haveAmountBefore) and haveAmountBefore or reqAmount
            print(string.format("📤 กำลังส่ง %s:%s x%d ไปยัง %s", cat, key, finalAmount, targetUsername))
            
            -- สั่งส่งของ
            SendSingleMail(playerData.UserId, cat, key, finalAmount, note)
            
            -- รอระบบเกมอัปเดตข้อมูลสักครู่
            task.wait(1.2)

            -- 2. เช็คกระเป๋าหลังส่งเพื่อยืนยันว่าของลดจริงไหม
            local currentInvAfter = GetMyInventory()
            local haveAmountAfter = GetItemCount(currentInvAfter, cat, key)

            -- ถ้าจำนวนลดลง แสดงว่าส่งสำเร็จ
            if haveAmountAfter < haveAmountBefore then
                totalSuccess = totalSuccess + 1
                print("✅ success - ส่งสำเร็จ!")
                table.insert(itemResults, {
                    category = cat,
                    itemKey = key,
                    amount = finalAmount,
                    status = "success"
                })
            else
                totalFail = totalFail + 1
                warn("❌ fail - การส่งล้มเหลว (ของในตัวไม่ลด)")
                table.insert(itemResults, {
                    category = cat,
                    itemKey = key,
                    amount = finalAmount,
                    status = "fail",
                    reason = "Item count did not change"
                })
            end
        else
            totalFail = totalFail + 1
            warn(string.format("⚠️ fail - ข้าม %s:%s (ไม่มีไอเทม)", cat, key))
            table.insert(itemResults, {
                category = cat,
                itemKey = key,
                amount = reqAmount,
                status = "fail",
                reason = "Not enough items"
            })
        end
        task.wait(0.3)
    end

    print(string.format("🎯 สรุปผล: Success %d | Fail %d", totalSuccess, totalFail))

    -- 3. ส่งรายงานผลลัพธ์กลับไปยัง Web Server
    pcall(function()
        httpRequest({
            Url = WEB_URL .. "/api/report-result",
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body = HttpService:JSONEncode({
                sender = localPlayer.Name,
                targetPlayer = targetUsername,
                status = (totalFail == 0 and totalSuccess > 0) and "success" or "fail",
                successCount = totalSuccess,
                failCount = totalFail,
                total = #itemsList,
                itemsDetail = itemResults,
                webhookUrl = webhookUrl or ""
            })
        })
    end)
end

-- 1. ซิงค์ Inventory ขึ้นเว็บทุก 5 วิ
task.spawn(function()
    while task.wait(5) do
        pcall(function()
            local inventory = GetMyInventory()
            httpRequest({
                Url = WEB_URL .. "/api/sync-inventory",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode({ username = localPlayer.Name, inventory = inventory })
            })
        end)
    end
end)

print("🌐 [Ready] ระบบส่งของพร้อมตัวเช็ค Success/Fail ทำงานแล้ว!")

-- 2. วนลูปเช็กคิวคำสั่งจากเว็บ
task.spawn(function()
    while task.wait(2) do
        pcall(function()
            local res = httpRequest({
                Url = WEB_URL .. "/api/fetch-command?username=" .. localPlayer.Name,
                Method = "GET"
            })
            
            if res and res.StatusCode == 200 then
                local data = HttpService:JSONDecode(res.Body)
                
                if data and data.hasCommand then
                    local cmd = data.command
                    print(string.format("📥 ได้รับคำสั่ง! ส่งให้ %s ทั้งหมด %d รายการ", cmd.targetPlayer, #cmd.items))
                    ProcessMultiItemQueue(cmd.targetPlayer, cmd.items, cmd.note, cmd.webhookUrl)
                end
            end
        end)
    end
end)