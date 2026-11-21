"""
Gera o kit de personagens do Bocha 3D no Blender (sem interface):

  blender -b -P tools/blender/make_people.py -- public/models/people.glb

Cada variante é um corpo low-poly feito com o modificador Skin (sobre um
"esqueleto" de arestas), cabeça com nariz, orelhas, olhos e cabelo/boné,
um esqueleto (armature) com ossos nomeados e pesos calculados por distância
aos ossos. A cor de cada parte (pele, camisa, calça, canela, antebraço,
sapato, cabelo, boné, olhos) vai codificada na cor de vértice (canal R) para
que o jogo pinte cada torcedor com um único material.

Convenções: Z para cima, personagem olhando para -Y (frente), esquerda = +X.
"""

import math
import sys

import bmesh
import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "people.glb"

# ids das partes (decodificados no shader do jogo: floor(r * 10))
SKIN, SHIRT, PANTS, SHOES, HAIR, CAP, DARK, SHIN, FOREARM = 0, 1, 2, 3, 4, 5, 6, 7, 8


def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def joints(build):
    """posições das juntas. build: 'slim' | 'regular' | 'belly'"""
    w = {"slim": 0.94, "regular": 1.0, "belly": 1.05}[build]
    J = {
        "pelvis": (0, 0, 0.95),
        "spine": (0, -0.01, 1.12),
        "chest": (0, 0, 1.32),
        "neck": (0, 0.0, 1.5),
        "shoulder.L": (0.2 * w, 0, 1.44),
        "elbow.L": (0.235 * w, 0.02, 1.17),
        "wrist.L": (0.255 * w, 0.0, 0.93),
        "hand.L": (0.262 * w, -0.01, 0.84),
        "hip.L": (0.095 * w, 0, 0.92),
        "knee.L": (0.105 * w, -0.01, 0.5),
        "ankle.L": (0.11 * w, 0.02, 0.085),
        "toe.L": (0.115 * w, -0.13, 0.035),
    }
    for k in list(J):
        if k.endswith(".L"):
            x, y, z = J[k]
            J[k[:-2] + ".R"] = (-x, y, z)
    if build == "belly":
        J["spine"] = (0, -0.07, 1.1)
    return {k: Vector(v) for k, v in J.items()}


EDGES = [
    ("pelvis", "spine"), ("spine", "chest"), ("chest", "neck"),
    ("chest", "shoulder.L"), ("shoulder.L", "elbow.L"), ("elbow.L", "wrist.L"), ("wrist.L", "hand.L"),
    ("chest", "shoulder.R"), ("shoulder.R", "elbow.R"), ("elbow.R", "wrist.R"), ("wrist.R", "hand.R"),
    ("pelvis", "hip.L"), ("hip.L", "knee.L"), ("knee.L", "ankle.L"), ("ankle.L", "toe.L"),
    ("pelvis", "hip.R"), ("hip.R", "knee.R"), ("knee.R", "ankle.R"), ("ankle.R", "toe.R"),
]


def radii(build):
    b = {"slim": 0.92, "regular": 1.0, "belly": 1.0}[build]
    R = {
        "pelvis": (0.165, 0.12),
        "spine": (0.155, 0.12),
        "chest": (0.18, 0.12),
        "neck": (0.064, 0.064),
        "shoulder": (0.068, 0.066),
        "elbow": (0.05, 0.05),
        "wrist": (0.038, 0.034),
        "hand": (0.046, 0.026),
        "hip": (0.098, 0.096),
        "knee": (0.064, 0.064),
        "ankle": (0.05, 0.05),
        "toe": (0.055, 0.036),
    }
    if build == "belly":
        R["spine"] = (0.215, 0.21)
        R["pelvis"] = (0.18, 0.15)
        R["chest"] = (0.195, 0.14)
    out = {}
    for name, (rx, ry) in R.items():
        out[name] = (rx * b, ry * b)
    return out


def body_mesh(build):
    J = joints(build)
    names = list(J)
    me = bpy.data.meshes.new("body")
    me.from_pydata([J[n] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    ob = bpy.data.objects.new("body", me)
    bpy.context.collection.objects.link(ob)
    skin = ob.modifiers.new("skin", "SKIN")
    skin.use_smooth_shade = True
    R = radii(build)
    for i, n in enumerate(names):
        key = n.split(".")[0]
        me.skin_vertices[0].data[i].radius = R[key]
    me.skin_vertices[0].data[names.index("pelvis")].use_root = True
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    # só este objeto selecionado: o convert aplicaria os modificadores (inclusive
    # o Armature) de qualquer outro personagem que ainda estivesse selecionado
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return ob


def add_sphere(name, loc, scale, segs=14, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.scale = scale
    for p in me.polygons:
        p.use_smooth = True
    return ob


def head_parts(head):
    """cabeça + acessórios. head: 'hair' | 'bald' | 'cap' | 'darkhair'"""
    parts = []
    hc = Vector((0, -0.01, 1.665))
    h = add_sphere("head", hc, (0.1, 0.112, 0.125))
    h["part"] = SKIN
    parts.append(h)
    nose = add_sphere("nose", hc + Vector((0, -0.112, -0.02)), (0.018, 0.025, 0.03), 8, 6)
    nose["part"] = SKIN
    parts.append(nose)
    for sx in (-1, 1):
        ear = add_sphere("ear", hc + Vector((sx * 0.098, 0.0, -0.005)), (0.015, 0.03, 0.04), 8, 6)
        ear["part"] = SKIN
        parts.append(ear)
        eye = add_sphere("eye", hc + Vector((sx * 0.037, -0.1, 0.018)), (0.013, 0.01, 0.011), 8, 6)
        eye["part"] = DARK
        parts.append(eye)
        brow = add_sphere("brow", hc + Vector((sx * 0.038, -0.104, 0.043)), (0.024, 0.008, 0.007), 8, 4)
        brow["part"] = HAIR
        parts.append(brow)
    if head in ("hair", "darkhair"):
        hair = add_sphere("hair", hc + Vector((0, 0.006, 0.024)), (0.106, 0.118, 0.118))
        # só a parte de cima/trás vira cabelo: achata a frente baixa
        for v in hair.data.vertices:
            if v.co.z < -0.15 and v.co.y < 0.2:
                v.co.z = -0.15
            if v.co.z < -0.55:
                v.co.z = -0.55
        hair["part"] = HAIR
        parts.append(hair)
    elif head == "bald":
        fringe = add_sphere("fringe", hc + Vector((0, 0.01, -0.005)), (0.103, 0.115, 0.07))
        fringe["part"] = HAIR
        # coroa de cabelo só dos lados e atrás
        bm = bmesh.new()
        bm.from_mesh(fringe.data)
        kill = [v for v in bm.verts if v.co.z > 0.55 or (v.co.y < -0.3 and v.co.z > -0.6)]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
        bm.to_mesh(fringe.data)
        bm.free()
        parts.append(fringe)
    else:
        cap = add_sphere("cap", hc + Vector((0, 0.0, 0.03)), (0.108, 0.12, 0.11), 16, 10)
        for v in cap.data.vertices:
            if v.co.z < 0.0:
                v.co.z = 0.0
        cap["part"] = CAP
        parts.append(cap)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        me = bpy.data.meshes.new("brim")
        bm.to_mesh(me)
        bm.free()
        brim = bpy.data.objects.new("brim", me)
        bpy.context.collection.objects.link(brim)
        brim.location = hc + Vector((0, -0.125, 0.032))
        brim.scale = (0.17, 0.11, 0.012)
        brim.rotation_euler = (math.radians(-8), 0, 0)
        brim["part"] = CAP
        parts.append(brim)
        back = add_sphere("hairback", hc + Vector((0, 0.03, -0.02)), (0.1, 0.1, 0.07))
        back["part"] = HAIR
        parts.append(back)
    return parts


def classify_body(ob, build):
    """atribui id de parte a cada face do corpo pela posição"""
    me = ob.data
    J = joints(build)
    ids = []
    for p in me.polygons:
        c = ob.matrix_world @ p.center
        ax = abs(c.x)
        torso_half = 0.17 if build != "belly" else 0.2
        if c.z < 0.115:
            ids.append(SHOES)
        elif c.z < 0.53 and ax < 0.2:
            ids.append(SHIN)
        elif c.z < 0.95 and ax < 0.2:
            ids.append(PANTS)
        elif c.z > 1.47 and ax < 0.075:
            ids.append(SKIN)
        elif ax > torso_half and c.z < J["elbow.L"].z + 0.06:
            ids.append(FOREARM if c.z > J["wrist.L"].z + 0.02 else SKIN)
        else:
            ids.append(SHIRT)
    return ids


def set_part_colors(ob, face_ids):
    me = ob.data
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for p, pid in zip(me.polygons, face_ids):
        v = (pid + 0.5) / 10.0
        for li in p.loop_indices:
            attr.data[li].color = (v, 0.0, 0.0, 1.0)


BONES = [
    # nome, cabeça, cauda, pai
    ("hips", "pelvis", "spine", None),
    ("spine", "spine", "chest", "hips"),
    ("chest", "chest", "neck", "spine"),
    ("neck", "neck", (0, 0, 1.58), "chest"),
    ("head", (0, 0, 1.58), (0, 0, 1.8), "neck"),
    ("upper_arm.L", "shoulder.L", "elbow.L", "chest"),
    ("forearm.L", "elbow.L", "wrist.L", "upper_arm.L"),
    ("hand.L", "wrist.L", "hand.L", "forearm.L"),
    ("upper_arm.R", "shoulder.R", "elbow.R", "chest"),
    ("forearm.R", "elbow.R", "wrist.R", "upper_arm.R"),
    ("hand.R", "wrist.R", "hand.R", "forearm.R"),
    ("thigh.L", "hip.L", "knee.L", "hips"),
    ("shin.L", "knee.L", "ankle.L", "thigh.L"),
    ("foot.L", "ankle.L", "toe.L", "shin.L"),
    ("thigh.R", "hip.R", "knee.R", "hips"),
    ("shin.R", "knee.R", "ankle.R", "thigh.R"),
    ("foot.R", "ankle.R", "toe.R", "shin.R"),
]


def make_armature(name, build):
    J = joints(build)
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for bname, h, t, parent in BONES:
        b = arm.edit_bones.new(bname)
        b.head = J[h] if isinstance(h, str) else Vector(h)
        b.tail = J[t] if isinstance(t, str) else Vector(t)
        b.roll = 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        eb[bname] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


def skin_weights(ob, rig, head_vertex_count):
    """pesos por distância aos 2 ossos mais próximos (cabeça e acessórios = osso head)"""
    bones = rig.data.bones
    segs = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in bones}
    groups = {name: ob.vertex_groups.new(name=name) for name in segs}
    n = len(ob.data.vertices)
    for v in ob.data.vertices:
        if v.index >= n - head_vertex_count:
            groups["head"].add([v.index], 1.0, "REPLACE")
            continue
        p = ob.matrix_world @ v.co
        cands = []
        for name, (a, b) in segs.items():
            # braços não puxam o tronco e vice-versa (evita "derreter" as axilas)
            side_arm = name.startswith(("upper_arm", "forearm", "hand"))
            if side_arm and abs(p.x) < 0.15:
                continue
            if name in ("head",) and p.z < 1.52:
                continue
            cands.append((seg_dist(p, a, b), name))
        cands.sort()
        d0, n0 = cands[0]
        d1, n1 = cands[1]
        w0 = 1.0 / (d0 ** 4 + 1e-7)
        w1 = 1.0 / (d1 ** 4 + 1e-7)
        if d1 > d0 * 2.2:
            w1 = 0.0
        s = w0 + w1
        groups[n0].add([v.index], w0 / s, "REPLACE")
        if w1 > 0:
            groups[n1].add([v.index], w1 / s, "ADD")


def build_variant(name, build, head):
    body = body_mesh(build)
    ids = classify_body(body, build)
    set_part_colors(body, ids)
    parts = head_parts(head)
    head_count = 0
    for p in parts:
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        set_part_colors(p, [p["part"]] * len(p.data.polygons))
        head_count += len(p.data.vertices)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = "char_" + name
    body.data.name = "char_" + name
    rig = make_armature("rig_" + name, build)
    skin_weights(body, rig, head_count)
    body.parent = rig
    mod = body.modifiers.new("arm", "ARMATURE")
    mod.object = rig
    mat = bpy.data.materials.get("people") or bpy.data.materials.new("people")
    body.data.materials.clear()
    body.data.materials.append(mat)
    return rig, body


VARIANTS = [
    ("slim_hair", "slim", "hair"),
    ("regular_bald", "regular", "bald"),
    ("belly_cap", "belly", "cap"),
    ("regular_cap", "regular", "cap"),
    ("belly_bald", "belly", "bald"),
    ("slim_darkhair", "slim", "darkhair"),
]


def main():
    clean()
    for i, (name, build, head) in enumerate(VARIANTS):
        rig, _ = build_variant(name, build, head)
        rig.location.x = i * 0.8
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=False,
        export_skins=True,
        export_animations=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_materials="EXPORT",
        export_yup=True,
        export_apply=False,
    )
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"[make_people] {len(VARIANTS)} variantes, ~{tris} faces -> {OUT}")


main()
