
  // 2.2注册局部组件
const Node = {
    data: () => ({
        btn: 'Button',
        isOpenChildren: false,
        openChildrenCount: 0
    }),
    methods: {
       
    },
    name: 't-node',
    props: ['tree', 'Id', 'nodeName'],
    // computed: {
    //     childrenNodes: function() {
    //         return 
    //     }
    // },
    filters: {
        elles: function (value) {
            if (!value )  {
                const name = this.tree.name || this.tree.constructor
                return name
            }
            value = value.toString()
             return value.length >11 ? value.substring(0, 11) + '...' : value
        },
        nameParse: function( value) {

        }
    },
    methods: {
        handleClick(tree) {
        
            this.isOpenChildren = !this.isOpenChildren
            this.openChildrenCount = (this.openChildrenCount + 1)%15
            setTimeout(renderLines, 300)
        }
    },
    computed:{
     //使用计算属性将map装换为显示的列表
     comTree() {
            try {
                if(Object.prototype.toString.call(this.tree) == '[object Map]') {

                return Object.fromEntries(this.tree.entries())
            }
            if(Object.prototype.toString.call(this.tree) == '[object Set]') {

                return Array.from(this.tree).join('-')
            }
        
            if(this.tree[mobx.$mobx]) {
                this.tree['IamMobx'] = this.tree[mobx.$mobx]
            }
            return this.tree
        } catch (error) {
            return ''
        }
        
     },
     comName() {
        const info = this.tree
        let type = ''
        if(info && typeof info === 'object' && !['Object', 'Array'].includes(info.constructor.name) ) {
                type = info.constructor.name
        }
        return type ? this.nodeName + '::' + type : this.nodeName
     }
    },
    template: `<div class="tree" >
        <div  class="tree-node node" v-on:click="handleClick(1)" v-bind:id="Id" v-bind:title="comName">
        {{nodeName|elles}}
        </div>
      
            <div v-if="typeof comTree === 'object'" class="tree-children">
                <div v-for="(item, key, index) in comTree" v-if="index < openChildrenCount"  class="log-item">
                    <t-node v-if="comTree.hasOwnProperty && comTree.hasOwnProperty(key)" v-bind:tree="item" v-bind:Id="Id +'___'+ key" v-bind:nodeName="key" ></t-node>
                </div>
            </div>
            <div v-if="typeof comTree === 'function'" class="tree-children">
                <div  class="log-item  single-node">
                    这是一个函数
                </div>
            </div>
            <div v-if="typeof comTree !== 'object' && typeof comTree !== 'function'" class="tree-children">
                <div  class="log-item single-node">
                    {{comTree}}
                </div>
            </div>
    </div>`
}

 var app2 = new Vue({
        el: '#node',
        data: {
            tree: window.tree || {a: 1}
        },
        noLog: true,
        // 2.4局部组件使用
        components: {
            'tree-node': Node
        },
        mounted: function () {
         renderLines()
        },
        template: `<div class="log-node">
            <div class="svg-container"></div>
            <tree-node v-bind:tree="tree" Id="0" pId="" nodeName="root"></tree-node>
        </div>`
 })

window.renderLines = renderLines

function renderLines() {
    const nodes = document.querySelectorAll('.tree-node')
    let fragment = document.createElement('div')
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const nodeId = node.getAttribute('id')
        const parentId = nodeId?.substring(0,nodeId.lastIndexOf('___'))
        // console.log(nodeId, node,parentId)c
        if(!parentId) continue;
        const line = renderLine(`line-${nodeId}-${parentId}`)
        fragment.appendChild(line)
    }
    const svgContainer = document.querySelector('.svg-container')
    svgContainer.innerHTML = fragment.innerHTML
}

//具体一条边的绘制逻辑
function renderLine(id) {
    const line = document.querySelector(`.${id}`)
    let svg = null,
        path = null
    if (!line) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttributeNS('http://www.w3.org/2000/svg', 'd', '')
        svg.appendChild(path)
        svg.setAttribute('id', id)
    } else {
        svg = line
        path = svg.querySelector('path')
    }
    const arr = id.split('-')
    const nodeId = arr[1]
    const parentId = arr[2]
    const node = document.getElementById(nodeId)

    const parentNode = document.getElementById(parentId)
    if(!node||!parentNode) return svg;
    const { x: nx, y: ny } = getNodePosition(node)
    const { w: nw, h: nh } = getNodeSize(node)
    const { x: px, y: py } = getNodePosition(parentNode)
    const { w: pw, h: ph } = getNodeSize(parentNode)

    let width, height, left, top
    let d
    height = (ny + nh / 2) - (py + ph / 2)
    top = py + ph / 2 - 90
    if (px > nx) {
        width = (px + pw / 2) - (nx + nw / 2)
        left = nx + nw / 2
        d = `M${width} 0 L0 ${height}` //从右上角至左下角画线
    } else if (px < nx) {
        width = (nx + nw / 2) - (px + pw / 2)
        left = px + pw / 2
        d = `M0 0 L${width} ${height}` //从左上角至右下角画线
    } else {
        width = 2
        left = px + pw / 2
        d = `M ${width / 2} 0 L${width / 2} ${height}` //画一条竖直向下的线
    }

    const length = Math.round(Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2)))
    const val = length - (pw / 2 + nw / 2)

    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    path.setAttributeNS('http://www.w3.org/2000/svg', 'd', d)
    path.setAttribute('style', `stroke:black;stroke-dasharray:${val};stroke-dashoffset:-${pw / 2}`)
    svg.style = `position:absolute;left:${left}px;top:${top}px`
    return svg
}

function getNodePosition(node) {
    const { x, y } = node.getBoundingClientRect()
    return { x, y }
}

function getNodeSize(node) {
    const { width, height } = window.getComputedStyle(node)
    return { w: getNumFromPx(width), h: getNumFromPx(height) }
}

function getNumFromPx(str) {
    return Number(str.substring(0, str.indexOf('p')))
}

