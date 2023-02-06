window.logData =[ {
    'name': '这是log信息',
}]
window.tree = {
    store: {
       
    }
}
function dealObj(obj, n) {
    if(!obj) {
        return ""
    }
    if( obj instanceof Element ) {
       
        return "原生Element--" + obj.tagName
    } 
 
    else if(typeof obj !== 'object' ) {
        return obj
    }
   
    return   Object.keys(obj || {}).filter(item => item[0] !== '_').map((item) => {
        //  const constructor = obj[item] && obj[item].constructor ? '--' + obj[item].constructor.name : ''
       return  item + " : " + ( (typeof obj[item] !== 'object' && typeof obj[item] !== 'function') ?  String(obj[item]) :
               n > 0 ?dealObj(obj[item], n -1) : 
               obj[item] ?  Object.keys(obj[item]).slice(0,5).join(',') : "")
    }).join('\n  ')
}
window.logger = function (name, info) {
    if(!info) {
        info= ""
    }
    window.logData.push({
        name,
        info: (typeof info === 'string') ? info : Object.keys(info).map(key => {
               let type = 'primary'
            if(!info[key]) {
                return {key, type, value: '空值'}
            }
         
            if(info[key] && typeof info[key] === 'object' && !['Object', 'Array'].includes(info[key].constructor.name) ) {
                type = info[key].constructor.name
            }
            return {
                key,
                type,
                value: dealObj(info[key], 1)
            }
        })
    })
}
window.noder = (node) => {
    window.tree.store = node;
    console.log(node)
     setTimeout(() => {
        if(renderLines) {
            renderLines()
        }
     }, 2500)
}

window.parseFiber = function (fiber) {
    const $$type =(typeof fiber.type) === 'string' 
      ? fiber.type :fiber.type 
      ? fiber.type.name : '无type的fiber'

    return $$type
}


window.clearLog = function() {
    const log = {
    'name': '这是log信息',
    };

    window.logData.splice(0, window.logData.length, log)
}