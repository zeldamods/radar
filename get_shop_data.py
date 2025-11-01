#!/usr/bin/env python

import yaml

import glob
import json
import yaml

def u_constrt(loader, node):
    return node.value
def io_constrt(loader, node):
    value = loader.construct_mapping(node)
    return value
def list_constrt(loader, node):
    value = loader.construct_mapping(node)
    return value
def obj_constrt(loader, node):
    value = loader.construct_mapping(node)
    return value
def str_constrt(loader, node):
    return node.value
def vec3_constrt(loader, node):
    return node.value
def color_constrt(loader, node):
    return node.value
yaml.add_constructor('!u', u_constrt)
yaml.add_constructor('!io', io_constrt)
yaml.add_constructor('!color', color_constrt)
yaml.add_constructor('!list', list_constrt)
yaml.add_constructor('!obj', obj_constrt)
yaml.add_constructor('!str64', str_constrt)
yaml.add_constructor('!str32', str_constrt)
yaml.add_constructor('!str256', str_constrt)
yaml.add_constructor('!vec3', vec3_constrt)

locations = {
    '00': 'Dueling Peaks Stable',
    '01': 'Foothill Stable',
    '02': 'Gerudo Canyon Stable',
    '03': 'East Akkala Stable',
    '04': 'Tabantha Bridge Stable',
    '05': 'Serenne Stable',
    '06': 'South Akkala Stable',
    '07': 'Rito Stable',
    '08': 'Riverside Stable',
    '09': 'Lakeside Stable',
    '10': 'Outskirt Stable',
    '11': 'Woodland Stable',
    '12': 'Wetland Stable',
    '13': 'Snowfield Stable',
    '14': 'Highland Stable',
    '15': 'Kara Kara Bazaar',
}

# Shop names are not directly linked to the NPC, but they are physically close.
#    The shop names are in Msg_USen.product.sarc/EventFlowMsg/Signboard*.myst and
#    correspond to the UniqueName of the Signboard near the shops like
#    TwnObj_Village_HatenoSignboard_A_03, TwnObj_Village_HatenoSignboard_A_04 or
#    TwnObj_Village_RitoPharmacySign_A_01.
# Store the Shop's name with the NPC Shopkeeper
#   Tarrey Town shops are more complicated
shop_names = {
  'Npc_Kakariko014': "High Spirits Produce", # Trissa
  'Npc_Kakariko010': "The Curious Quiver", # Rola
  'Npc_Kakariko012': "Enchanted", # Claree
  'Npc_Kakariko006': "Olkin's Pumpkins", # Olkin
  'Npc_HatenoVillage002': "East Wind", # Pruce
  'Npc_HatenoVillage019': "Ventest Clothing Boutique", # Sophie
  'Npc_HatenoVillage001': "Kochi Dye Shop", # Sayge
  'Npc_Zora002': "Coral Reef", # Cleff
  'Npc_Zora033': "Hammerhead", # Dento
  'Npc_goron002': "Goron Gusto Shop", # Tanko
  'Npc_Goron005': "Protein Palace", # Aji
  'Npc_goron004': "Ripped and Shredded", # Rogaro
  'Npc_HighMountain021': "The Slippery Falcon", # Misa
  'Npc_HighMountain008': "Brazen Beak", # Nekk
  'Npc_oasis015': "Fashion Passion", # Saula
  'Npc_oasis005': "Gerudo Secret Club", # Greta
  'Npc_oasis001': "Starlight Memories", # Isha
  'Npc_SmallOasis003': "Kara Kara Bazaar General Store", # Shaillu
  'Npc_kokiri003': "General Shoppe", # Daz
  'Npc_kokiri004': "Spore Store", # Natie
  'Npc_oasis050': "Rhondson Armor Boutique", # Rhondson
  'Npc_HighMountain010': "Slippery Falcon (Tarrey Town Branch)", # Fyson
  'Npc_Goron025': "Ore and More", # Pelison
  'Npc_SouthernVillage005': "Lurelin General Store", # Mubs
}

beedle = {}
shops = {}

alias = {
    "Armor_011_Head": "Armor_030_Head",
    "Armor_011_Lower": "Armor_030_Lower",
    "Armor_011_Upper": "Armor_030_Upper",
}

def get_item_price(item):
    if item.startswith("Item_FishGet"):
        item = item.replace("Item_FishGet_", "Animal_Fish_")
    if item.startswith("Item_InsectGet"):
        item = item.replace("Item_InsectGet_", "Animal_Insect_")
    if item in alias:
        item = alias[item]
    if item.startswith("Horse_Link_Mane"):
        return 0
    with open(f'Actor/GeneralParamList/{item}.gparamlist.yml','r') as f:
        data = yaml.load(f, Loader=yaml.FullLoader)
        data = data['param_root']['objects']
        if not data.get('Item'):
            return 0
        return data['Item'].get('BuyingPrice') or 0

#for file in glob.glob('Actor/ShopData/Npc_TripMaster_*.shop.yml'):
for file in glob.glob('Actor/ShopData/*.shop.yml'):
    with open(file,'r') as f:
        sdata = yaml.load(f,  Loader=yaml.FullLoader)

        sdata = sdata['param_root']['objects']
        prices = {}
        for key in sdata.keys():
            for item, value in sdata[key].items():
                if item.startswith('ItemName'):
                    base = item.replace('Name','PriceBase')
                    price = item.replace('Name','Price')
                    adjust = item.replace('Name','AdjustPrice')
                    adjust = sdata[key][adjust]
                    prices[base] = get_item_price(value)
                    prices[price] = prices[base] + adjust
            sdata[key].update(prices)
        key = file.split('_')[-1].split('.')[0]
        key2 = file.split("/")[-1].replace(".shop.yml","")
        if file.split("/")[-1].startswith("Npc_TripMaster_"):
            beedle[locations[key]] = sdata
        shops[key2] = sdata
        if sdata.get('Cooking') and sdata.get('Compound'):
            print(key2)

shops = {
    "data": shops,
    "names": shop_names
}

json.dump(beedle, open('beedle_shop_data.json','w'), indent=2)
json.dump(shops, open('shop_data.json','w'), indent=2)
